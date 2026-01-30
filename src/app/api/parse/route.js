import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

// === 1. Notion 颜色映射表 (CSS样式) ===
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

// 辅助函数：给内容包裹颜色样式
function wrapColor(content, color) {
  if (!color || color === 'default') return content;
  const style = notionColors[color] || "";
  // 使用 span 或 div 包裹，为了不破坏 Markdown 的块级结构，这里用 div 比较安全，但行内用 span
  return `<div style="${style}">${content}</div>`;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const pageId = searchParams.get('page_id');
  const download = searchParams.get('download');
  const token = process.env.NOTION_TOKEN;

  if (!token || !pageId) return NextResponse.json({ error: "Config Error" }, { status: 500 });

  try {
    const notion = new Client({ auth: token });
    const n2m = new NotionToMarkdown({ notionClient: notion });

    // === 2. 自定义转换器：折叠列表 (Toggle) ===
    n2m.setCustomTransformer("toggle", async (block) => {
      const { toggle } = block;
      // 获取标题文本
      const text = toggle.rich_text.map(t => t.plain_text).join("");
      
      // 获取折叠内部的子块 (递归转换)
      const children = await n2m.pageToMarkdown(block.id);
      const childrenMd = n2m.toMarkdownString(children).parent;

      // 获取颜色样式
      const style = notionColors[block.toggle.color] || "";
      const styleAttr = style ? ` style="${style}"` : "";

      // 返回 HTML <details> 标签
      return `
<details${styleAttr}>
<summary style="cursor: pointer; font-weight: bold;">${text}</summary>
<div style="padding-left: 20px; margin-top: 10px;">

${childrenMd}

</div>
</details>`;
    });

    // === 3. 自定义转换器：段落 (Paragraph) 以保留颜色 ===
    // 注意：如果你覆盖了 paragraph，所有普通文本都会走这里
    n2m.setCustomTransformer("paragraph", async (block) => {
      const { paragraph } = block;
      // 转换内部的 rich_text (包含加粗、斜体等)
      // notion-to-md 内部暂时没有直接暴露 textToMarkdown，我们需要手动拼接或者简化处理
      // 简单处理：只取纯文本，或者保留加粗链接等 (需要调用内部方法，这里简化为纯文本+颜色)
      
      // 实际上，n2m 默认处理已经很好，为了颜色，我们需要劫持
      // 如果没有颜色，返回 false 让库使用默认处理，性能更好
      if (block.paragraph.color === 'default') {
        return false; 
      }

      const text = paragraph.rich_text.map(t => {
         let content = t.plain_text;
         if (t.annotations.bold) content = `**${content}**`;
         if (t.annotations.italic) content = `*${content}*`;
         if (t.annotations.code) content = `\`${content}\``;
         if (t.href) content = `[${content}](${t.href})`;
         return content;
      }).join("");

      if (!text) return ""; // 空行

      // 包裹颜色
      return wrapColor(text, block.paragraph.color);
    });

    // === 4. 自定义转换器：Callout (标注块) 颜色增强 ===
    n2m.setCustomTransformer("callout", async (block) => {
      const { callout } = block;
      const text = callout.rich_text.map(t => t.plain_text).join("");
      const icon = callout.icon?.emoji || "💡";
      const style = notionColors[callout.color] || "background: #f1f1f1;"; // 默认灰色背景

      return `<div style="${style} padding: 16px; display: flex; border-radius: 4px; margin: 1em 0;">
  <div style="font-size: 24px; margin-right: 12px;">${icon}</div>
  <div style="align-self: center;">${text}</div>
</div>`;
    });


    // === 执行转换 ===
    const mdblocks = await n2m.pageToMarkdown(pageId);
    const mdString = n2m.toMarkdownString(mdblocks);
    
    // 简单获取标题用于文件名
    const pageData = await notion.pages.retrieve({ page_id: pageId });
    let title = "Notion-Export";
    try {
        const titleProp = Object.values(pageData.properties).find(p => p.type === 'title');
        if(titleProp) title = titleProp.title[0]?.plain_text || "Untitled";
    } catch(e) {}

    const headers = {
      "Content-Type": "text/markdown; charset=utf-8",
    };
    if (download === 'true') {
      headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(title)}.md"`;
    }

    // 拼接标题和内容
    const finalOutput = `# ${title}\n\n${mdString.parent}`;

    return new Response(finalOutput, { status: 200, headers });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}