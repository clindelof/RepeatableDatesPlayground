import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  it('renders the playground heading', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Make recurring dates');
  });
});
