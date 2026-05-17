import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DemoTreeview1 } from './demo-treeview-1';

describe('DemoTreeview1', () => {
  let component: DemoTreeview1;
  let fixture: ComponentFixture<DemoTreeview1>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DemoTreeview1],
    }).compileComponents();

    fixture = TestBed.createComponent(DemoTreeview1);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
