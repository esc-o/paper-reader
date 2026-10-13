declare module 'page-flip/dist/js/page-flip.module.js' {
  export class PageFlip {
    constructor(element: HTMLElement, settings: Record<string, unknown>)
    loadFromHTML(items: HTMLElement[] | NodeListOf<HTMLElement>): void
    on(event: string, callback: (event: { data: number }) => void): void
    getCurrentPageIndex(): number
    turnToPage(page: number): void
    flipNext(corner?: 'top' | 'bottom'): void
    flipPrev(corner?: 'top' | 'bottom'): void
    destroy(): void
  }
}
