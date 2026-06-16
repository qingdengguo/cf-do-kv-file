export class FileSession {
  constructor(state, env) {
    this.state = state
    this.env = env
  }

  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === "/init") {
      const meta = await req.json()
      await this.state.storage.put("meta", meta)
      return new Response("OK")
    }

    if (url.pathname === "/chunk") {
      const index = url.searchParams.get("index")
      const buf = await req.arrayBuffer()
      const meta = await this.state.storage.get("meta")
      const key = `file:${meta.fileName}:${index}`
      await this.env.FILE_KV.put(key, buf)
      return new Response("OK")
    }

    if (url.pathname === "/complete") {
      await this.state.storage.put("completed", true)
      return new Response("OK")
    }

    if (url.pathname === "/download") {
      const meta = await this.state.storage.get("meta")
      const completed = await this.state.storage.get("completed")
      if (!completed) return new Response("Not ready", { status: 400 })

      const stream = new ReadableStream({
        async start(controller) {
          for (let i = 0; i < meta.totalChunks; i++) {
            const key = `file:${meta.fileName}:${i}`
            const chunk = await this.env.FILE_KV.get(key, { type: "arrayBuffer" })
            controller.enqueue(new Uint8Array(chunk))
          }
          controller.close()
        }
      })

      return new Response(stream, {
        headers: {
          "Content-Type": meta.type,
          "Content-Disposition": `attachment; filename="${meta.fileName}"`
        }
      })
    }

    return new Response("404", { status: 404 })
  }
}