// attachments.go implements the route the note editor uses to upload a pasted
// image. The image is normalized by internal/attachment (size, resolution)
// and stored in the "attachments" collection.
package serve

import (
	"errors"
	"io"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"

	"github.com/asano69/cardpod/internal/api"
	"github.com/asano69/cardpod/internal/attachment"
)

// maxUploadBytes bounds the size of an uploaded image before processing.
const maxUploadBytes = 10 << 20

// uploadAttachmentHandler serves POST /api/admin/attachments. The image comes
// in the "image" form field; the response holds the attachment path
// ("@/<recordId>/<filename>") to write in image notation. The path has no
// origin, so notes keep working when the server moves; the frontend resolves
// it (see frontend/src/lib/models/attachmentPath.ts).
func uploadAttachmentHandler(e *core.RequestEvent) error {
	e.Request.Body = http.MaxBytesReader(e.Response, e.Request.Body, maxUploadBytes)
	upload, _, err := e.Request.FormFile("image")
	if err != nil {
		return e.BadRequestError(`an image of at most 10 MB is required in the "image" form field`, err)
	}
	defer upload.Close()

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

	file, err := filesystem.NewFileFromBytes(result.Data, "image"+result.Ext)
	if err != nil {
		return e.InternalServerError("make attachment file", err)
	}
	collection, err := e.App.FindCollectionByNameOrId("attachments")
	if err != nil {
		return e.InternalServerError("load attachments collection", err)
	}
	record := core.NewRecord(collection)
	record.Set("image", file)
	// The size after processing, i.e. what is actually stored.
	record.Set("filesize", len(result.Data))
	if err := e.App.Save(record); err != nil {
		return e.InternalServerError("save attachment", err)
	}

	url := "@/" + record.Id + "/" + record.GetString("image")
	return e.JSON(http.StatusOK, api.UploadAttachmentResponse{URL: url})
}
