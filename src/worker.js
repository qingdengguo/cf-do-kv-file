import { FileSession } from "./fileSession"

export { FileSession }

export default {
  async fetch(req, env) {
    const url = new URL(req.url)

    if (req.method === "POST" && url.pathname === "/upload/init") {
      const { fileName, totalChunks, type } = await req.json()
      const fileId = crypto.randomUUID()

      const stub = env.FILE_SESSION.get(
        env.FILE_SESSION.idFromName(fileId)
      )

      await stub.fetch("https://do/init", {
        method: "POST",
        body: JSON.stringify({ fileName, totalChunks, type })
      })

      return Response.json({ fileId })
    }

    if (req.method === "POST" && url.pathname === "/upload/chunk") {
      const fileId = url.searchParams.get("fileId")
      const index = url.searchParams.get("index")

      const stub = env.FILE_SESSION.get(
        env.FILE_SESSION.idFromName(fileId)
      )

      return stub.fetch(`https://do/chunk?index=${index}`, req)
    }

    if (req.method === "POST" && url.pathname === "/upload/complete") {
      const { fileId } = await req.json()
      const stub = env.FILE_SESSION.get(
        env.FILE_SESSION.idFromName(fileId)
      )
      return stub.fetch("https://do/complete", { method: "POST" })
    }

    if (req.method === "GET" && url.pathname.startsWith("/download/")) {
      const fileId = url.pathname.split("/").pop()
      const stub = env.FILE_SESSION.get(
        env.FILE_SESSION.idFromName(fileId)
      )
      return stub.fetch("https://do/download")
    }

    return new Response("Not Found", { status: 404 })
  }
}