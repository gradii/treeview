import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DemoTreeview2 } from './demo-treeview-2';

describe('DemoTreeview2', () => {
  let component: DemoTreeview2;
  let fixture: ComponentFixture<DemoTreeview2>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DemoTreeview2],
    }).compileComponents();

    fixture = TestBed.createComponent(DemoTreeview2);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
