import { Component, OnInit, PLATFORM_ID, Inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ChatService, ChatResponse, RelatedDoc, KnowledgeBaseStatus } from '../shared/services/chat.service';
import { MarkdownToHtmlPipe } from '../shared/pipes/markdown-to-html.pipe';
import { map, take } from 'rxjs/operators';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MarkdownToHtmlPipe],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss'
})
export class ChatComponent implements OnInit {
  @ViewChild('chatMessages') chatMessagesRef!: ElementRef;
  @ViewChild('messageInputElem') messageInputRef!: ElementRef<HTMLTextAreaElement>;

  messages: { 
    type: 'user' | 'assistant' | 'system', 
    content: string, 
    sources?: RelatedDoc[],
    showSources?: boolean 
  }[] = [];
  
  messageInput: string = '';
  showSources: boolean = true;
  isTyping: boolean = false;
  currentChatId: string | null = null;
  lastUserMessage: string = '';
  relatedDocs: RelatedDoc[] = [];
  kbStatus: KnowledgeBaseStatus = { files_count: 0, chunks_count: 0 };
  
  constructor(
    private chatService: ChatService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      // 加載本地儲存的來源顯示設置
      const savedShowSources = localStorage.getItem('showSources');
      if (savedShowSources !== null) {
        this.showSources = savedShowSources === 'true';
      }
      
      // 加載聊天歷史
      this.loadChatHistory();
      
      // 加載知識庫狀態
      this.loadKnowledgeBaseStatus();
    } else {
      // 在伺服器端渲染時添加歡迎消息
      this.addSystemMessage('歡迎使用 RAG 知識庫系統！您可以向我詢問關於您知識庫中的任何問題。');
    }
  }

  // 發送消息
  sendMessage(): void {
    if (!this.messageInput.trim()) return;
    
    const message = this.messageInput.trim();
    this.addUserMessage(message);
    this.messageInput = '';
    this.isTyping = true;
    this.lastUserMessage = message;
    
    this.chatService.sendMessage(message, this.showSources)
      .subscribe({
        next: (response) => {
          this.isTyping = false;
          this.addAssistantMessage(response.assistant_message, response.related_docs, response.show_sources);
          this.currentChatId = response.id;
          this.relatedDocs = response.related_docs;
        },
        error: (error) => {
          this.isTyping = false;
          console.error('發送消息時出錯:', error);
          this.addSystemMessage('發送消息時出錯，請稍後再試。');
        }
      });
  }

  // 重新生成回答
  regenerateAnswer(): void {
    if (!this.lastUserMessage || !this.currentChatId) return;
    
    this.isTyping = true;
    
    // 移除最後一條助手消息
    const assistantIndex = this.messages.findIndex(
      msg => msg.type === 'assistant' && this.messages.indexOf(msg) === this.messages.length - 1
    );
    
    if (assistantIndex !== -1) {
      this.messages.splice(assistantIndex, 1);
    }
    
    this.chatService.regenerateAnswer(this.lastUserMessage, this.currentChatId, this.showSources)
      .subscribe({
        next: (response) => {
          this.isTyping = false;
          this.addAssistantMessage(response.assistant_message, response.related_docs, response.show_sources);
          this.currentChatId = response.id;
          this.relatedDocs = response.related_docs;
        },
        error: (error) => {
          this.isTyping = false;
          console.error('重新生成回答時出錯:', error);
          this.addSystemMessage('重新生成回答時出錯，請稍後再試。');
        }
      });
  }

  // 清空對話
  clearChat(): void {
    if (this.safeConfirm('確定要清空所有對話嗎？此操作無法撤銷。')) {
      this.chatService.clearChatHistory()
        .subscribe({
          next: (response) => {
            if (response.success) {
              this.messages = [];
              this.addSystemMessage('歡迎使用 RAG 知識庫系統！您可以向我詢問關於您知識庫中的任何問題。');
              this.relatedDocs = [];
              this.currentChatId = null;
              this.lastUserMessage = '';
            } else {
              this.addSystemMessage('清除對話歷史失敗。');
            }
          },
          error: (error) => {
            console.error('清除對話歷史時出錯:', error);
            this.addSystemMessage('清除對話歷史時出錯，請稍後再試。');
          }
        });
    }
  }

  // 保存對話記錄
  saveChatHistory(): void {
    if (isPlatformBrowser(this.platformId)) {
      const userMessages = this.messages.filter(msg => msg.type === 'user').map(msg => msg.content);
      const assistantMessages = this.messages.filter(msg => msg.type === 'assistant').map(msg => msg.content);
      
      if (userMessages.length === 0) {
        this.safeAlert('沒有對話可保存');
        return;
      }
      
      let chatText = '# RAG 知識庫系統對話記錄\n\n';
      chatText += `生成時間: ${new Date().toLocaleString()}\n\n`;
      
      for (let i = 0; i < userMessages.length; i++) {
        chatText += `## 問題 ${i + 1}\n\n`;
        chatText += `${userMessages[i]}\n\n`;
        
        if (i < assistantMessages.length) {
          chatText += `### 回答\n\n`;
          chatText += `${assistantMessages[i]}\n\n`;
        }
      }
      
      const blob = new Blob([chatText], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rag-chat-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      
      setTimeout(() => URL.revokeObjectURL(url), 100);
    }
  }

  // 切換來源顯示
  toggleSourcesDisplay(): void {
    localStorage.setItem('showSources', this.showSources.toString());
    
    // 實際上不更改已經加載的消息的來源顯示，只保存設置用於下一條消息
    this.showToast(`來源列表已${this.showSources ? '顯示' : '隱藏'}`);
  }

  // 複製回答內容
  copyAnswer(content: string, event: Event): void {
    event.stopPropagation();
    if (isPlatformBrowser(this.platformId)) {
      navigator.clipboard.writeText(content).then(() => {
        const button = event.target as HTMLElement;
        const originalHtml = button.innerHTML;
        button.innerHTML = '<i class="bi bi-check"></i>';
        
        setTimeout(() => {
          button.innerHTML = originalHtml;
        }, 2000);
      });
    }
  }

  // 處理Enter鍵提交
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  // 添加系統消息
  private addSystemMessage(content: string): void {
    this.messages.push({ type: 'system', content });
    this.scrollToBottom();
  }

  // 添加用戶消息
  private addUserMessage(content: string): void {
    this.messages.push({ type: 'user', content });
    this.scrollToBottom();
  }

  // 添加助手消息
  private addAssistantMessage(content: string, sources: RelatedDoc[] = [], showSources: boolean = true): void {
    this.messages.push({ 
      type: 'assistant', 
      content, 
      sources, 
      showSources
    });
    this.scrollToBottom();
  }

  // 加載聊天歷史
  private loadChatHistory(): void {
    this.chatService.getChatHistory()
      .subscribe({
        next: (history) => {
          if (history.length > 0) {
            this.messages = [];
            
            history.forEach(item => {
              this.addUserMessage(item.user_message);
              this.addAssistantMessage(item.assistant_message, item.related_docs, item.show_sources);
            });
            
            const lastItem = history[history.length - 1];
            this.lastUserMessage = lastItem.user_message;
            this.currentChatId = lastItem.id;
            this.relatedDocs = lastItem.related_docs;
          } else {
            this.addSystemMessage('歡迎使用 RAG 知識庫系統！您可以向我詢問關於您知識庫中的任何問題。');
          }
        },
        error: (error) => {
          console.error('加載聊天歷史時出錯:', error);
          this.addSystemMessage('加載聊天歷史時出錯，請稍後再試。');
        }
      });
  }

  // 加載知識庫狀態
  private loadKnowledgeBaseStatus(): void {
    this.chatService.getKnowledgeBaseStatus()
      .subscribe({
        next: (status) => {
          this.kbStatus = status;
        },
        error: (error) => {
          console.error('載入知識庫狀態時出錯:', error);
        }
      });
  }

  // 滾動到底部
  private scrollToBottom(): void {
    setTimeout(() => {
      if (this.chatMessagesRef && isPlatformBrowser(this.platformId)) {
        this.chatMessagesRef.nativeElement.scrollTop = this.chatMessagesRef.nativeElement.scrollHeight;
      }
    }, 0);
  }

  // 顯示提示
  private showToast(message: string): void {
    if (isPlatformBrowser(this.platformId)) {
      const toast = document.createElement('div');
      toast.className = 'toast align-items-center text-white bg-info border-0';
      toast.style.position = 'fixed';
      toast.style.bottom = '20px';
      toast.style.right = '20px';
      toast.style.zIndex = '9999';
      toast.innerHTML = `
          <div class="d-flex">
              <div class="toast-body">${message}</div>
              <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
          </div>
      `;
      document.body.appendChild(toast);
      setTimeout(() => {
        toast.classList.add('show');
        setTimeout(() => {
          toast.classList.remove('show');
          setTimeout(() => toast.remove(), 300);
        }, 3000);
      }, 100);
    }
  }

  // 安全地顯示警告，確保在伺服器端不會出錯
  private safeAlert(message: string): void {
    if (isPlatformBrowser(this.platformId)) {
      alert(message);
    } else {
      console.warn('Server-side alert:', message);
    }
  }
  
  // 安全地顯示確認對話框，在伺服器端總是返回false
  private safeConfirm(message: string): boolean {
    if (isPlatformBrowser(this.platformId)) {
      return confirm(message);
    } else {
      console.warn('Server-side confirm:', message);
      return false;
    }
  }
}
