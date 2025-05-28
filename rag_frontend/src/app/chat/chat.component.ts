import { Component, OnInit, PLATFORM_ID, Inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { ChatService, ChatResponse, RelatedDoc, KnowledgeBaseStatus, Conversation } from '../shared/services/chat.service';
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
  @ViewChild('titleEditInput') titleEditInputRef!: ElementRef<HTMLInputElement>;

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
  
  // 新增對話相關屬性
  conversations: Conversation[] = [];
  currentConversationId: string | null = null;
  isConversationListOpen: boolean = true;
  newConversationTitle: string = '';
  isMobile: boolean = false;
  isTemporaryConversation: boolean = false; // 標記是否為臨時對話（尚未發送消息）
  isCreatingNewConversation: boolean = false; // 標記是否正在創建新對話
  
  // 編輯標題相關屬性
  editingConversationId: string | null = null; // 正在編輯標題的對話ID
  editingTitle: string = ''; // 編輯中的標題內容
  
  constructor(
    private chatService: ChatService,
    private route: ActivatedRoute,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      // 設置移動端檢測
      this.isMobile = window.innerWidth < 768;
      window.addEventListener('resize', () => {
        this.isMobile = window.innerWidth < 768;
        if (this.isMobile) {
          this.isConversationListOpen = false;
        }
      });
      
      // 添加全局點擊事件監聽器，用於取消編輯模式
      document.addEventListener('click', (event) => {
        if (this.editingConversationId && !event.target) return;
        
        const target = event.target as HTMLElement;
        const isEditContainer = target.closest('.edit-title-container');
        const isEditButton = target.closest('.btn[title="編輯標題"]');
        
        if (!isEditContainer && !isEditButton && this.editingConversationId) {
          this.cancelTitleEdit();
        }
      });
      
      // 加載本地儲存的來源顯示設置
      const savedShowSources = localStorage.getItem('showSources');
      if (savedShowSources !== null) {
        this.showSources = savedShowSources === 'true';
      }
      
      // 初始化聊天系統
      this.initializeChat();
      
      // 加載知識庫狀態
      this.loadKnowledgeBaseStatus();
    } else {
      // 在伺服器端渲染時添加歡迎消息
      this.addSystemMessage('歡迎使用 RAG 知識庫系統！您可以向我詢問關於您知識庫中的任何問題。');
    }
  }

  // 初始化聊天系統
  private async initializeChat(): Promise<void> {
    try {
      // 首先加載對話列表
      await this.loadConversations();
      
      // 然後處理路由參數
      this.route.params.subscribe(params => {
        const conversationId = params['id'];
        
        if (conversationId) {
          // 如果URL中有對話ID，加載該對話
          console.log('從URL加載對話:', conversationId);
          this.currentConversationId = conversationId;
          this.isTemporaryConversation = false; // 重置臨時對話狀態
          this.loadChatHistory(conversationId);
        } else {
          // 如果沒有指定對話ID，處理默認情況
          this.handleNoConversationId();
        }
      });
    } catch (error) {
      console.error('初始化聊天系統時出錯:', error);
      this.addSystemMessage('初始化聊天系統時出錯，請刷新頁面重試。');
    }
  }

  // 處理沒有指定對話ID的情況
  private handleNoConversationId(): void {
    console.log('處理沒有對話ID的情況，當前對話數量:', this.conversations.length);
    console.log('isTemporaryConversation 狀態:', this.isTemporaryConversation);
    
    // 檢查是否是從新對話按鈕來的（通過檢查isTemporaryConversation標記）
    if (this.isTemporaryConversation) {
      // 如果是新對話，保持在空白狀態
      console.log('這是新對話，保持空白狀態');
      this.addSystemMessage('開始新對話。您可以向我詢問關於您知識庫中的任何問題。');
      return;
    }
    
    if (this.conversations.length > 0) {
      // 有對話時，導航到最新的對話
      console.log('找到現有對話，導航到最新對話:', this.conversations[0].id);
      this.currentConversationId = this.conversations[0].id;
      this.isTemporaryConversation = false;
      this.router.navigate(['/chat', this.currentConversationId]);
    } else {
      // 沒有對話時，設置為臨時對話狀態，這樣用戶發送第一條消息時會創建新對話
      console.log('沒有現有對話，設置為臨時對話狀態');
      this.isTemporaryConversation = true; // 改為true，讓第一條消息觸發新對話創建
      this.addSystemMessage('歡迎使用 RAG 知識庫系統！您可以向我詢問關於您知識庫中的任何問題。');
    }
  }

  // 加載所有對話
  async loadConversations(): Promise<void> {
    try {
      console.log('開始加載對話列表...');
      const conversationsData = await this.chatService.getConversations().toPromise();
      this.conversations = conversationsData || [];
      console.log('對話列表加載完成:', this.conversations.length, '個對話');
    } catch (error) {
      console.error('加載對話列表時出錯:', error);
      this.conversations = [];
      throw error; // 重新拋出錯誤，讓調用者處理
    }
  }

  // 檢查當前對話是否為空（沒有用戶消息）
  get isCurrentConversationEmpty(): boolean {
    const hasUserMessages = this.messages.some(msg => msg.type === 'user');
    
    // 如果是臨時對話且沒有用戶消息，認為是空的
    if (this.isTemporaryConversation && !hasUserMessages) {
      return true;
    }
    
    // 如果有對話ID但沒有用戶消息，認為是空的
    if (this.currentConversationId && !hasUserMessages) {
      return true;
    }
    
    // 其他情況（沒有對話ID且沒有用戶消息）認為不是空的，允許創建新對話
    return false;
  }

  // 創建新對話
  async createNewConversation(): Promise<void> {
    try {
      console.log('開啟新的臨時對話框');
      console.log('設置前 isTemporaryConversation:', this.isTemporaryConversation);
      
      // 立即開啟新的對話框，但不創建後端記錄
      this.currentConversationId = null;
      this.isTemporaryConversation = true;
      this.isCreatingNewConversation = false; // 不需要這個標記了
      this.messages = [];
      this.relatedDocs = [];
      this.currentChatId = null;
      this.lastUserMessage = '';
      
      console.log('設置後 isTemporaryConversation:', this.isTemporaryConversation);
      
      // 直接添加歡迎消息
      this.addSystemMessage('開始新對話。您可以向我詢問關於您知識庫中的任何問題。');
      
      // 手動更新瀏覽器URL，不觸發Angular路由
      window.history.replaceState(null, '', '/chat');
      
    } catch (error) {
      console.error('創建新對話時出錯:', error);
      this.addSystemMessage('創建新對話時出錯，請稍後再試。');
    }
  }

  // 切換到指定對話
  switchConversation(conversationId: string): void {
    if (this.currentConversationId === conversationId) return;
    
    // 先保存當前會話ID
    const previousConversationId = this.currentConversationId;
    
    // 設置新的會話ID並重置臨時對話狀態
    this.currentConversationId = conversationId;
    this.isTemporaryConversation = false;
    this.router.navigate(['/chat', conversationId]);
    
    // 清除當前顯示的消息，並加載選定對話的歷史
    this.messages = [];
    this.relatedDocs = [];
    this.currentChatId = null;
    this.lastUserMessage = '';
    
    // 加載新對話的歷史
    this.loadChatHistory(conversationId);
    
    // 在移動設備上切換對話後自動關閉側邊欄
    if (this.isMobile) {
      this.isConversationListOpen = false;
    }
  }

  // 刪除對話
  async deleteConversation(event: Event, conversationId: string): Promise<void> {
    event.stopPropagation();
    if (!this.safeConfirm('確定要刪除此對話嗎？此操作無法撤銷。')) return;
    
    try {
      await this.chatService.deleteConversation(conversationId).toPromise();
      this.conversations = this.conversations.filter(conv => conv.id !== conversationId);
      
      // 如果刪除的是當前對話，切換到其他對話或創建新對話
      if (this.currentConversationId === conversationId) {
        if (this.conversations.length > 0) {
          this.switchConversation(this.conversations[0].id);
        } else {
          // 沒有其他對話時，清空聊天並導航到基本聊天頁面
          this.currentConversationId = null;
          this.isTemporaryConversation = false;
          this.messages = [];
          this.relatedDocs = [];
          this.currentChatId = null;
          this.lastUserMessage = '';
          this.router.navigate(['/chat']);
          this.addSystemMessage('歡迎使用 RAG 知識庫系統！您可以向我詢問關於您知識庫中的任何問題。');
        }
      }
    } catch (error) {
      console.error('刪除對話時出錯:', error);
      this.addSystemMessage('刪除對話時出錯，請稍後再試。');
    }
  }

  // 更新對話標題
  async updateConversationTitle(conversationId: string, newTitle: string): Promise<void> {
    if (!newTitle.trim()) return;
    
    try {
      const updatedConversation = await this.chatService.updateConversationTitle(conversationId, newTitle).toPromise();
      if (updatedConversation) {
        const index = this.conversations.findIndex(conv => conv.id === conversationId);
        if (index !== -1) {
          this.conversations[index] = updatedConversation;
        }
      }
    } catch (error) {
      console.error('更新對話標題時出錯:', error);
    }
  }

  // 開始編輯標題
  startTitleEdit(event: Event, conversationId: string, currentTitle: string): void {
    event.stopPropagation(); // 防止觸發對話切換
    this.editingConversationId = conversationId;
    this.editingTitle = currentTitle;
    
    // 使用setTimeout確保DOM更新後再聚焦
    setTimeout(() => {
      // 使用ViewChild來聚焦輸入框
      if (this.titleEditInputRef && this.titleEditInputRef.nativeElement) {
        this.titleEditInputRef.nativeElement.focus();
        this.titleEditInputRef.nativeElement.select();
      }
    }, 100);
  }

  // 保存標題編輯
  async saveTitleEdit(event: Event, conversationId: string): Promise<void> {
    event.stopPropagation();
    
    if (!this.editingTitle.trim()) {
      this.cancelTitleEdit();
      return;
    }
    
    try {
      await this.updateConversationTitle(conversationId, this.editingTitle.trim());
      this.editingConversationId = null;
      this.editingTitle = '';
    } catch (error) {
      console.error('保存標題時出錯:', error);
      this.addSystemMessage('更新對話標題失敗，請稍後再試。');
    }
  }

  // 取消標題編輯
  cancelTitleEdit(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.editingConversationId = null;
    this.editingTitle = '';
  }

  // 處理標題編輯的鍵盤事件
  onTitleEditKeydown(event: KeyboardEvent, conversationId: string): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.saveTitleEdit(event, conversationId);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelTitleEdit();
    }
  }

  // 切換側邊欄顯示/隱藏
  toggleConversationList(): void {
    this.isConversationListOpen = !this.isConversationListOpen;
  }

  // 發送消息
  sendMessage(): void {
    if (!this.messageInput.trim()) return;
    
    const message = this.messageInput.trim();
    this.addUserMessage(message);
    this.messageInput = '';
    this.isTyping = true;
    this.lastUserMessage = message;
    
    this.chatService.sendMessage(message, this.currentConversationId, this.showSources)
      .subscribe({
        next: (response) => {
          this.isTyping = false;
          this.addAssistantMessage(response.assistant_message, response.related_docs, response.show_sources);
          this.currentChatId = response.id;
          this.relatedDocs = response.related_docs;
          
          // 如果這是臨時對話的第一條消息，處理對話創建
          if (this.isTemporaryConversation) {
            console.log('臨時對話發送第一條消息，更新狀態');
            this.isTemporaryConversation = false;
            
            // 從響應中獲取對話ID
            if (response.conversation_id) {
              this.currentConversationId = response.conversation_id;
              console.log('從響應中獲取對話ID:', response.conversation_id);
              
              // 更新URL
              this.router.navigate(['/chat', response.conversation_id]);
              
              // 重新加載對話列表以顯示新創建的對話
              this.loadConversations().catch(error => {
                console.error('重新加載對話列表時出錯:', error);
              });
            } else {
              console.error('響應中沒有對話ID');
            }
          } else if (this.currentConversationId) {
            // 如果是現有對話，只需更新對話列表
            this.loadConversations();
          }
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
    
    // 添加當前對話ID以便API能關聯消息到正確對話
    this.chatService.regenerateAnswer(this.lastUserMessage, this.currentChatId, this.showSources, this.currentConversationId)
      .subscribe({
        next: (response) => {
          this.isTyping = false;
          this.addAssistantMessage(response.assistant_message, response.related_docs, response.show_sources);
          this.currentChatId = response.id;
          this.relatedDocs = response.related_docs || [];
          
          // 如果對話ID存在，重新加載對話列表以更新最後修改時間
          if (this.currentConversationId) {
            this.loadConversations();
          }
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
      this.chatService.clearChatHistory(this.currentConversationId)
        .subscribe({
          next: (response) => {
            if (response.success) {
              this.messages = [];
              this.addSystemMessage('歡迎使用 RAG 知識庫系統！您可以向我詢問關於您知識庫中的任何問題。');
              this.relatedDocs = [];
              this.currentChatId = null;
              this.lastUserMessage = '';
              this.isTemporaryConversation = false; // 重置臨時對話狀態
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
  private loadChatHistory(conversationId: string | null = null): void {
    this.isTyping = true; // 顯示加載中狀態
    this.isTemporaryConversation = false; // 重置臨時對話狀態
    
    this.chatService.getChatHistory(conversationId)
      .subscribe({
        next: (history) => {
          this.isTyping = false;
          this.messages = []; // 先清空消息列表
          
          if (history.length > 0) {
            history.forEach(item => {
              this.addUserMessage(item.user_message);
              this.addAssistantMessage(item.assistant_message, item.related_docs, item.show_sources);
            });
            
            const lastItem = history[history.length - 1];
            this.lastUserMessage = lastItem.user_message;
            this.currentChatId = lastItem.id;
            this.relatedDocs = lastItem.related_docs || [];
          } else {
            // 如果是空對話，顯示歡迎消息
            this.addSystemMessage('歡迎使用 RAG 知識庫系統！您可以向我詢問關於您知識庫中的任何問題。');
            this.relatedDocs = [];
          }
        },
        error: (error) => {
          this.isTyping = false;
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
          console.error('加載知識庫狀態時出錯:', error);
        }
      });
  }

  // 滾動到底部
  private scrollToBottom(): void {
    if (isPlatformBrowser(this.platformId)) {
    setTimeout(() => {
        if (this.chatMessagesRef) {
          this.chatMessagesRef.nativeElement.scrollTo({
            top: this.chatMessagesRef.nativeElement.scrollHeight,
            behavior: 'smooth'
          });
      }
      }, 100);
    }
  }

  // 顯示提示
  private showToast(message: string): void {
    if (isPlatformBrowser(this.platformId)) {
      const toast = document.createElement('div');
      toast.className = 'toast show';
      toast.innerHTML = `
        <div class="toast-header">
          <strong class="me-auto">通知</strong>
          <button type="button" class="btn-close" onclick="this.parentElement.parentElement.remove()"></button>
        </div>
        <div class="toast-body">
          ${message}
          </div>
      `;
      
      document.body.appendChild(toast);
      
      // 自動關閉
        setTimeout(() => {
          toast.classList.remove('show');
        setTimeout(() => toast.remove(), 500);
        }, 3000);
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
