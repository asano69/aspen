// attachments.go implements the routes the note editor uses to upload and show
// a pasted image. The image is normalized by internal/attachment (size,
// resolution) and stored once per content hash in the "files" collection.
// Each pod that uses it gets its own "pod_files" row, whose ULID-based
// filename is what a note refers to ("@/files/<ULID><ext>"). A note therefore
// carries no pod or record id and stays portable.
package serve

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"path"

	"github.com/oklog/ulid/v2"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"

	"github.com/asano69/aspen/internal/api"
	"github.com/asano69/aspen/internal/attachment"
)

// maxUploadBytes bounds the size of an uploaded image before processing.
const maxUploadBytes = 10 << 20

// attachmentPrefix is how a note refers to an uploaded file. It is resolved by
// frontend/src/lib/models/attachmentPath.ts and served by serveAttachmentHandler.
const attachmentPrefix = "@/files/"

// uploadAttachmentHandler serves POST /api/admin/attachments. The image comes
// in the "image" form field and the pod it is used in in the "pod" field. The
// response holds the path to write in image notation.
func uploadAttachmentHandler(e *core.RequestEvent) error {
	e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, maxUploadBytes)
	upload, _, err := e.Request.FormFile("image")
	if err != nil {
		return e.BadRequestError(`an image of at most 10 MB is required in the "image" form field`, err)
	}
	defer upload.Close()

	podID := e.Request.FormValue("pod")
	if _, err := e.App.FindRecordById("pods", podID); errors.Is(err, sql.ErrNoRows) {
		return e.BadRequestError(`an existing pod is required in the "pod" form field`, err)
	} else if err != nil {
		return e.InternalServerError("find pod", err)
	}

	data, err := io.ReadAll(upload)
	if err != nil {
		return e.BadRequestError("failed to read the image", err)
	}

	// The type is sniffed from the content: the client's header is not trusted.
	result, err := attachment.Process(http.DetectContentType(data), data)
	if errors.Is(err, attachment.ErrUnsupported) {
		return e.BadRequestError("this image type is not supported", err)
	}
	if err != nil {
		return e.BadRequestError("failed to process the image", err)
	}

	filename, err := storeAttachment(e.App, podID, result)
	if err != nil {
		return e.InternalServerError("store attachment", err)
	}
	return e.JSON(http.StatusOK, api.UploadAttachmentResponse{URL: attachmentPrefix + filename})
}

// storeAttachment makes the processed image available to the pod and returns
// the filename a note uses:
//   - the pod already has this content: its existing filename;
//   - only another pod has it: a new filename, sharing the stored file;
//   - nobody has it: the file is stored, then a new filename.
func storeAttachment(app core.App, podID string, result attachment.Result) (string, error) {
	sum := sha256.Sum256(result.Data)
	hash := hex.EncodeToString(sum[:])

	var filename string
	err := app.RunInTransaction(func(tx core.App) error {
		file, err := findOrCreateFile(tx, hash, result)
		if err != nil {
			return err
		}
		filename, err = findOrCreatePodFile(tx, podID, file, result.Ext)
		return err
	})
	return filename, err
}

// findOrCreateFile returns the "files" row of the content with the given hash,
// storing the content first when there is none.
func findOrCreateFile(tx core.App, hash string, result attachment.Result) (*core.Record, error) {
	file, err := tx.FindFirstRecordByFilter("files", "hash = {:hash}", dbx.Params{"hash": hash})
	if err == nil {
		return file, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	collection, err := tx.FindCachedCollectionByNameOrId("files")
	if err != nil {
		return nil, err
	}
	stored, err := filesystem.NewFileFromBytes(result.Data, "file"+result.Ext)
	if err != nil {
		return nil, err
	}
	file = core.NewRecord(collection)
	file.Set("file", stored)
	file.Set("filesize", len(result.Data))
	file.Set("hash", hash)
	return file, tx.Save(file)
}

// findOrCreatePodFile returns the filename under which the pod uses file,
// creating a new ULID-based one when the pod does not use it yet.
func findOrCreatePodFile(tx core.App, podID string, file *core.Record, ext string) (string, error) {
	podFile, err := tx.FindFirstRecordByFilter(
		"pod_files", "pod = {:pod} && file = {:file}",
		dbx.Params{"pod": podID, "file": file.Id},
	)
	if err == nil {
		return podFile.GetString("filename"), nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}

	collection, err := tx.FindCachedCollectionByNameOrId("pod_files")
	if err != nil {
		return "", err
	}
	filename := ulid.Make().String() + ext
	podFile = core.NewRecord(collection)
	podFile.Set("pod", podID)
	podFile.Set("file", file.Id)
	podFile.Set("filename", filename)
	return filename, tx.Save(podFile)
}

// importAttachment makes an attachment of an export available to podID under
// its original filename, so the notes that refer to it keep working. The bytes
// are stored as they are, without the processing done for uploads. Content is
// stored once per hash, as in storeAttachment.
func importAttachment(app core.App, podID, filename string, content []byte) error {
	sum := sha256.Sum256(content)
	result := attachment.Result{Data: content, Ext: path.Ext(filename)}
	return app.RunInTransaction(func(tx core.App) error {
		file, err := findOrCreateFile(tx, hex.EncodeToString(sum[:]), result)
		if err != nil {
			return err
		}
		return ensurePodFile(tx, podID, file.Id, filename)
	})
}

// ensurePodFile makes filename refer to the file fileID in the pod. An existing
// row with that filename is kept as it is.
func ensurePodFile(tx core.App, podID, fileID, filename string) error {
	_, err := tx.FindFirstRecordByFilter(
		"pod_files", "pod = {:pod} && filename = {:name}",
		dbx.Params{"pod": podID, "name": filename},
	)
	if err == nil {
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	collection, err := tx.FindCachedCollectionByNameOrId("pod_files")
	if err != nil {
		return err
	}
	podFile := core.NewRecord(collection)
	podFile.Set("pod", podID)
	podFile.Set("file", fileID)
	podFile.Set("filename", filename)
	return tx.Save(podFile)
}

// serveAttachmentHandler serves GET /files/{name}: the stored file behind a
// pod_files filename. It needs no login, like any <img> source. Filenames
// never change their content, so the response may be cached for good.
func serveAttachmentHandler(e *core.RequestEvent) error {
	name := e.Request.PathValue("name")
	file, err := findStoredFile(e.App, name)
	if errors.Is(err, sql.ErrNoRows) {
		return e.NotFoundError("file not found", nil)
	}
	if err != nil {
		return e.InternalServerError("find file", err)
	}

	fsys, err := e.App.NewFilesystem()
	if err != nil {
		return e.InternalServerError("open file storage", err)
	}
	defer fsys.Close()

	e.Response.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	key := file.BaseFilesPath() + "/" + file.GetString("file")
	if err := fsys.Serve(e.Response, e.Request, key, name); err != nil {
		return e.NotFoundError("file not found", err)
	}
	return nil
}

// findStoredFile returns the "files" row behind a pod_files filename, or
// sql.ErrNoRows.
func findStoredFile(app core.App, filename string) (*core.Record, error) {
	podFile, err := app.FindFirstRecordByFilter(
		"pod_files", "filename = {:name}", dbx.Params{"name": filename},
	)
	if err != nil {
		return nil, err
	}
	return app.FindRecordById("files", podFile.GetString("file"))
}
