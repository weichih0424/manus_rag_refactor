import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { TagService } from '../shared/services/tag.service';
import { TagModel } from '../shared/models/file.model';

@Component({
  selector: 'app-settings-base',
  standalone: true,
  imports: [CommonModule, FormsModule, NgSelectModule],
  templateUrl: './settings-base.component.html',
  styleUrl: './settings-base.component.scss'
})
export class SettingsBaseComponent implements OnInit {
  tagCategories: TagModel[] = [];
  newTagName: string = '';
  selectedColor: string = 'secondary';
  isAddingTag: boolean = false;
  
  // 預設顏色選項
  colorOptions = [
    { value: 'primary', text: '藍色' },
    { value: 'secondary', text: '灰色' },
    { value: 'success', text: '綠色' },
    { value: 'danger', text: '紅色' },
    { value: 'warning', text: '黃色' },
    { value: 'info', text: '青色' },
    { value: 'dark', text: '深灰' }
  ];

  constructor(
    private tagService: TagService
  ) {}

  ngOnInit(): void {
    this.loadTagCategories();
  }

  // 加載標籤類別
  loadTagCategories(): void {
    this.tagService.getTags().subscribe({
      next: (tags) => {
        this.tagCategories = tags;
      },
      error: (error) => {
        console.error('載入標籤類別失敗:', error);
        this.showToast('載入標籤類別失敗', 'danger');
      }
    });
  }

  // 新增標籤類別
  async addTagCategory(): Promise<void> {
    if (this.isAddingTag) {
      return;
    }
    
    this.isAddingTag = true;
    
    const tagName = this.newTagName.trim();
    const tagColor = this.selectedColor;
    
    // 表單驗證
    if (!tagName) {
      this.showToast('請輸入標籤名稱', 'danger');
      this.isAddingTag = false;
      return;
    }
    
    if (tagName.includes(',')) {
      this.showToast('標籤名稱不可包含逗號', 'danger');
      this.isAddingTag = false;
      return;
    }
    
    if (tagName.length > 20) {
      this.showToast('標籤名稱不得超過 20 字', 'danger');
      this.isAddingTag = false;
      return;
    }
    
    if (this.tagCategories.some(tag => tag.name.toLowerCase() === tagName.toLowerCase())) {
      this.showToast('標籤名稱已存在', 'danger');
      this.isAddingTag = false;
      return;
    }
    
    this.tagService.addTag({ name: tagName, color: tagColor }).subscribe({
      next: (response) => {
        // 處理 Django REST framework 返回的標籤對象
        if (response && response.id) {
          // 直接使用返回的標籤對象
          this.tagCategories.push(response);
          this.newTagName = '';
          this.selectedColor = 'secondary';
          this.showToast('標籤類別新增成功', 'success');
        } else {
          throw new Error('返回格式錯誤，缺少標籤ID');
        }
      },
      error: (error) => {
        console.error('新增標籤類別失敗:', error);
        this.showToast(`新增標籤類別失敗: ${error.message}`, 'danger');
        this.loadTagCategories(); // 重新載入確保資料一致
      },
      complete: () => {
        this.isAddingTag = false;
      }
    });
  }

  // 刪除標籤類別
  deleteTagCategory(tagId: string): void {
    if (confirm('確定要刪除此標籤類別嗎？此操作會移除所有檔案中的該標籤。')) {
      this.tagService.deleteTag(tagId).subscribe({
        next: (response) => {
          // Django REST框架成功刪除後可能返回204 No Content，無響應體
          // 所以這裡不需要檢查響應內容，只需要在成功時更新UI
          this.tagCategories = this.tagCategories.filter(tag => tag.id !== tagId);
          this.showToast('標籤類別已刪除', 'success');
        },
        error: (error) => {
          console.error('刪除標籤類別失敗:', error);
          this.showToast('刪除標籤類別失敗: ' + error.message, 'danger');
        }
      });
    }
  }

  // 顯示通知訊息
  showToast(message: string, type: string = 'danger'): void {
    // 這裡簡化實現，在實際應用中可能需要更複雜的通知元件
    alert(message);
  }
}
