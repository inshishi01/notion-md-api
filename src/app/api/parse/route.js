// src/app/api/parse/route.js
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { NextResponse } from "next/server";

export async function GET(request) {
  // 1. 获取 URL 中的 page_id 参数
  // 例如: /api/parse?page_id=xxxx
  const { searchParams } = new URL(request.url);
  const pageId = searchParams.get('page_id');

  // 2. 检查 Token 是否配置
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Server configuration error: Missing NOTION_TOKEN" }, { status: 500 });
  }

  // 3. 检查 Page ID 是否存在
  if (!pageId) {
    return NextResponse.json({ error: "Missing 'page_id' parameter" }, { status: 400 });
  }

  try {
    // 4. 初始化 Notion 客户端
    const notion = new Client({ auth: token });
    const n2m = new NotionToMarkdown({ notionClient: notion });

    // 5. 转换核心逻辑
    const mdblocks = await n2m.pageToMarkdown(pageId);
    const mdString = n2m.toMarkdownString(mdblocks);

    // 返回纯文本 Response，而不是 JSON
    return new Response(mdContent, {
        status: 200,
        headers: {
        // 告诉浏览器这是一个 Markdown 文件
        "Content-Type": "text/markdown; charset=utf-8",
        // 如果想访问时直接下载文件，取消下面这行的注释:
        // "Content-Disposition": 'attachment; filename="export.md"',
        },
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to convert page", details: error.message }, { status: 500 });
  }
}