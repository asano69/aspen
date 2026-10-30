# cm-websocket

CodeMirror 6 の `@codemirror/collab` を WebSocket で使うためのライブラリ。

## 通信プロトコル

すべて `type` を持つ JSON テキストメッセージ。

| type | 向き | 内容 |
|---|---|---|
| `push` | client → server | `{version, updates}` 未確認の更新 |
| `updates` | server → client | `{from, updates}` 受理済みの更新 |

`collab.WithTracker` の `Message()` は、独自の server → client メッセージを足す口。
client 側は `channel.on("type", handler)` で受ける。

## 使い方

```go
mux.Handle("/connection/collab", collab.New())
```

```ts
const channel = connect("ws://host/connection/collab");
extensions: [collabExtension(channel)]
```

`cursorsExtension` は `collabExtension` の後ろに置く。
