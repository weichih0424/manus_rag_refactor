import { Component, OnInit, PLATFORM_ID, Inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsService, SystemSettings } from '../shared/services/settings.service';

@Component({
  selector: 'app-settings-system',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings-system.component.html',
  styleUrl: './settings-system.component.scss'
})
export class SettingsSystemComponent implements OnInit {
  // 設置數據
  settings: SystemSettings = {
    embedding_model: 'BAAI/bge-large-zh',
    chunk_size: 1000,
    chunk_overlap: 200,
    top_k: 4,
    use_rag_fusion: false,
    use_reranking: false,
    llm_model: 'gpt-3.5-turbo',
    temperature: 0.1,
    max_tokens: 1000,
    use_cot: false
  };

  // 保存原始嵌入模型，用於檢測變更
  originalEmbeddingModel: string = '';
  
  // UI 狀態
  isSaving: boolean = false;
  showToast: boolean = false;
  isFormDirty: boolean = false;
  
  constructor(
    private settingsService: SettingsService,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadSettings();
    }
  }

  loadSettings(): void {
    this.settingsService.getSettings().subscribe({
      next: (data) => {
        this.settings = data;
        this.originalEmbeddingModel = data.embedding_model;
      },
      error: (error) => {
        console.error('載入設置時出錯:', error);
        this.safeAlert('載入設置時出錯，請刷新頁面重試。');
      }
    });
  }

  saveSettings(): void {
    this.isSaving = true;
    
    this.settingsService.saveSettings(this.settings).subscribe({
      next: (response) => {
        this.isSaving = false;
        
        if (response.success) {
          this.showToast = true;
          setTimeout(() => this.showToast = false, 3000);
          this.isFormDirty = false;
          
          // 如果更改了嵌入模型，顯示警告
          if (this.settings.embedding_model !== this.originalEmbeddingModel) {
            this.safeAlert('警告：更改嵌入模型將需要重新處理所有文檔。');
            this.originalEmbeddingModel = this.settings.embedding_model;
          }
        } else {
          this.safeAlert('保存設置失敗: ' + (response.error || '未知錯誤'));
        }
      },
      error: (error) => {
        console.error('保存設置時出錯:', error);
        this.safeAlert('保存設置時出錯，請稍後再試。');
        this.isSaving = false;
      }
    });
  }

  resetSettings(): void {
    if (this.safeConfirm('確定要重置所有設置為默認值嗎？')) {
      this.settings = {
        embedding_model: 'BAAI/bge-large-zh',
        chunk_size: 1000,
        chunk_overlap: 200,
        top_k: 4,
        use_rag_fusion: false,
        use_reranking: false,
        llm_model: 'gpt-3.5-turbo',
        temperature: 0.1,
        max_tokens: 1000,
        use_cot: false
      };
      this.isFormDirty = true;
    }
  }

  // 標記表單為已修改
  onFormChange(): void {
    this.isFormDirty = true;
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
