import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

// 样式映射表 (保持不变)
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

  if (!token || !pageId) return NextResponse.json({ error: "Config Error" }, { status: 500 });

  try {
    const notion = new Client({ auth: token });
    const n2m = new NotionToMarkdown({ notionClient: notion });

    // === 关键修复：智能段落处理 ===
    // 只有在段落有颜色时才自定义，否则交给库默认处理
    n2m.setCustomTransformer("paragraph", async (block) => {
      const { paragraph } = block;
      const color = paragraph.color;

      if (color === 'default') {
        // 没有颜色，返回 false，让 nottion-to-md 用默认的、最稳定的方式处理
        return false;
      }
      
      // 有颜色，我们手动处理
      // 先让库把内部的文本（加粗、链接等）转成 Markdown
      const defaultMarkdown = await n2m.blockToMarkdown(paragraph.rich_text);
      
      // 然后我们给它包上一层带颜色的 div
      const style = notionColors[color] || "";
      return `<div style="${style}">${defaultMarkdown}</div>`;
    });

    // === 自定义: Toggle 折叠列表 (逻辑加固) ===
    n2m.setCustomTransformer("toggle", async (block) => {
      if (!block.has_children) {
        // 如果折叠列表是空的，只显示标题
        const summaryText = block.toggle.rich_text.map(t => t.plain_text).join("");
        return `<details><summary style="cursor: pointer; font-weight: bold;">${summaryText}</summary><div></div></details>`;
      }
      
      const summaryText = block.toggle.rich_text.map(t => t.plain_text).join("");
      const children = await n2m.pageToMarkdown(block.id);
      const childrenMd = n2m.toMarkdownString(children).parent;
      
      return `<details><summary style="cursor: pointer; font-weight: bold;">${summaryText}</summary><div style="padding-left: 20px;">${childrenMd}</div></details>`;
    });

    // === 自定义: Callout (保持不变) ===
    n2m.setCustomTransformer("callout", async (block) => {
      const text = block.callout.rich_text.map(t => t.plain_text).join("");
      const icon = block.callout.icon?.emoji || "💡";
      const style = notionColors[block.callout.color] || "background: #f1f1f1;";
      return `<div style="${style} padding: 12px; display: flex; border-radius: 4px; margin: 8px 0;">
        <span style="margin-right: 8px; font-size: 1.2em;">${icon}</span>
        <span>${text}</span>
      </div>`;
    });

    // === 执行转换流程 (保持不变) ===
    const pageData = await notion.pages.retrieve({ page_id: pageId });
    const mdblocks = await n2m.pageToMarkdown(pageId);
    const mdString = n2m.toMarkdownString(mdblocks);

    if (!mdString.parent || mdString.parent.trim().length === 0) {
      return NextResponse.json({ error: "No content found. Check Notion permissions." }, { status: 404 });
    }

    let title = "Notion-Export";
    try {
      const titleProp = Object.values(pageData.properties).find(p => p.type === 'title');
      if (titleProp) title = titleProp.title[0]?.plain_text || "Untitled";
    } catch (e) {}

    const finalOutput = `# ${title}\n\n${mdString.parent}`;
    const headers = { "Content-Type": "text/markdown; charset=utf-8" };
    if (download === 'true') {
      headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(title)}.md"`;
    }

    return new Response(finalOutput, { status: 200, headers });

  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}