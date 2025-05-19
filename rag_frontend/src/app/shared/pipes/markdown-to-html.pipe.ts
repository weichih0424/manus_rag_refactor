import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({
  name: 'markdownToHtml',
  standalone: true
})
export class MarkdownToHtmlPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(value: string): SafeHtml {
    if (!value) return this.sanitizer.bypassSecurityTrustHtml('');
    
    // 基本的 Markdown 轉換
    let html = value
      // 標題
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      // 粗體
      .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
      // 斜體
      .replace(/\*(.*?)\*/gim, '<em>$1</em>')
      // 鏈接
      .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank">$1</a>')
      // 代碼塊
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      // 行內代碼
      .replace(/`([^`]+)`/gim, '<code>$1</code>')
      // 無序列表
      .replace(/^\s*-\s*(.*$)/gim, '<ul><li>$1</li></ul>')
      // 段落
      .replace(/\n/gim, '<br>');
    
    // 修復生成的 HTML 中連續的 <ul><li> 標籤
    html = html.replace(/<\/ul><ul>/g, '');
    
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
} 