import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

// 样式映射表
const notionColors = {
  "gray": "color: #9B9A97;",
  "brown": "color: #64473A;",
  "orange": "color: #D9730D;",
  "yellow": "color: #DFAB01;",
  "green": "color: #0F7B6C;",
  "blue": "color: #0B6E99;",
  "purple": "color: #6940A5;",
  "pink": "color: #AD1A72;",
  "red": "color: #E03E3E;",
  "gray_background": "background: #EBECED; padding: 2px 5px; border-radius: 3px;",
  "brown_background": "background: #E9E5E3; padding: 2px 5px; border-radius: 3px;",
  "orange_background": "background: #FAEBDD; padding: 2px 5px; border-radius: 3px;",
  "yellow_background": "background: #FBF3DB; padding: 2px 5px; border-radius: 3px;",
  "green_background": "background: #DDEDEA; padding: 2px 5px; border-radius: 3px;",
  "blue_background": "background: #DDEBF1; padding: 2px 5px; border-radius: 3px;",
  "purple_background": "background: #EAE4F2; padding: 2px 5px; border-radius: 3px;",
  "pink_background": "background: #F4DFEB; padding: 2px 5px; border-radius: 3px;",
  "red_background": "background: #FBE4E4; padding: 2px 5px; border-radius: 3px;",
};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const pageId = searchParams.get('page_id');
  const download = searchParams.get('download');
  const token = process.env.NOTION_TOKEN;

  // 检查配置
  if (!token) return NextResponse.json({ error: "Missing NOTION_TOKEN in Vercel env" }, { status: 500 });
  if (!pageId) return NextResponse.json({ error: "Missing 'page_id' in URL" }, { status: 400 });

  try {
    const notion = new Client({ auth: token });
    const n2m = new NotionToMarkdown({ notionClient: notion });

    // === 自定义: Toggle 折叠列表 ===
    n2m.setCustomTransformer("toggle", async (block) => {
      const text = block.toggle.rich_text.map(t => t.plain_text).join("");
      const children = await n2m.pageToMarkdown(block.id);
      const childrenMd = n2m.toMarkdownString(children).parent;
      return `<details><summary style="cursor: pointer; font-weight: bold;">${text}</summary><div style="padding-left: 20px;">\n${childrenMd}\n</div></details>`;
    });

    // === 自定义: Paragraph (修复版) ===
    // 我们不再使用 return false，而是手动处理所有段落，确保稳健
    n2m.setCustomTransformer("paragraph", async (block) => {
      const { paragraph } = block;
      if (!paragraph.rich_text || paragraph.rich_text.length === 0) {
        return ""; // 空行
      }

      // 手动拼接文本和链接
      const textContent = paragraph.rich_text.map(t => {
        let txt = t.plain_text;
        // 简单的加粗/斜体处理 (HTML方式，兼容性更好)
        if (t.annotations.bold) txt = `<b>${txt}</b>`;
        if (t.annotations.italic) txt = `<i>${txt}</i>`;
        if (t.annotations.code) txt = `\`${txt}\``;
        if (t.href) txt = `<a href="${t.href}">${txt}</a>`;
        return txt;
      }).join("");

      // 如果有颜色，加 div；如果没有，直接返回文本
      const colorStyle = notionColors[paragraph.color];
      if (colorStyle) {
        return `<div style="${colorStyle}">${textContent}</div>`;
      } else {
        return `${textContent}\n\n`; // 默认情况，加换行
      }
    });

    // === 自定义: Callout ===
    n2m.setCustomTransformer("callout", async (block) => {
      const text = block.callout.rich_text.map(t => t.plain_text).join("");
      const icon = block.callout.icon?.emoji || "💡";
      const style = notionColors[block.callout.color] || "background: #f1f1f1;";
      return `<div style="${style} padding: 12px; display: flex; border-radius: 4px; margin: 8px 0;">
        <span style="margin-right: 8px; font-size: 1.2em;">${icon}</span>
        <span>${text}</span>
      </div>`;
    });

    // === 执行转换 ===
    // 1. 获取页面信息 (用于标题)
    const pageData = await notion.pages.retrieve({ page_id: pageId });
    
    // 2. 获取 Block 内容
    const mdblocks = await n2m.pageToMarkdown(pageId);
    const mdString = n2m.toMarkdownString(mdblocks);

    // === 调试检查: 如果内容为空 ===
    if (!mdString.parent || mdString.parent.trim().length === 0) {
      console.log("Empty content detected. Check permissions.");
      return NextResponse.json({ 
        error: "No content found.", 
        hint: "Please make sure you have clicked 'Add Connections' -> 'Your Integration Name' on the Notion page.",
        debug_page_id: pageId
      }, { status: 404 });
    }

    // 提取标题
    let title = "Notion-Export";
    try {
      const titleProp = Object.values(pageData.properties).find(p => p.type === 'title');
      if (titleProp) title = titleProp.title[0]?.plain_text || "Untitled";
    } catch (e) {}

    // 组合输出
    const finalOutput = `# ${title}\n\n${mdString.parent}`;

    // 设置 Header
    const headers = {
      "Content-Type": "text/markdown; charset=utf-8",
    };
    if (download === 'true') {
      headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(title)}.md"`;
    }

    return new Response(finalOutput, { status: 200, headers });

  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}