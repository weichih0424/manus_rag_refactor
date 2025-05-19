import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingsBaseComponent } from './settings-base.component';

describe('SettingsBaseComponent', () => {
  let component: SettingsBaseComponent;
  let fixture: ComponentFixture<SettingsBaseComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsBaseComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SettingsBaseComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
