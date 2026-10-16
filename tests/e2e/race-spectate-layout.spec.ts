import { expect, test } from '@playwright/test'
import { BROWSER_SAVE_KEY } from '../../lib/career/browser-save'
import { buildFixture, fixtureLifecycle } from '../../lib/career/fixtures'
import { applyCareer } from '../../lib/career/lifecycle'

const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
]

for (const viewport of viewports) {
  for (const theme of ['light', 'dark'] as const) {
    for (const field of [12, 18] as const) {
      test(`spectate layout ${viewport.width}x${viewport.height} ${theme} ${field} runners`, async ({
        page,
      }, info) => {
        const fixture = buildFixture(`playback-${field}`)
        const career = fixture.career!
        const log = fixture.log!
        const lifecycle = applyCareer(fixtureLifecycle(false), career)
        await page.setViewportSize(viewport)
        await page.addInitScript(
          ({ key, career, log, lifecycle, theme }) => {
            localStorage.setItem('theme', theme)
            localStorage.setItem(
              key,
              JSON.stringify({
                version: 1,
                revision: 1,
                localCareerId: 'spectate-layout-fixture',
                career,
                lifecycle,
              }),
            )
            localStorage.setItem(`derby-race-log-v1:${log.raceRunId}`, JSON.stringify(log))
          },
          { key: BROWSER_SAVE_KEY, career, log, lifecycle, theme },
        )
        await page.goto('/')
        await page.getByRole('button', { name: '육성 계속', exact: true }).click()
        await page.getByRole('button', { name: '출전 정보 확인', exact: true }).click()
        await page.getByRole('button', { name: '레이스 시작', exact: true }).click()
        await page.getByRole('button', { name: '일시정지', exact: true }).click()
        await expect(page.locator('html')).toHaveClass(new RegExp(theme))
        await page.evaluate(() => document.fonts.ready)

        const layout = await page.locator('.lab-playback').evaluate((stage) => {
          const rect = (element: Element) => {
            const box = element.getBoundingClientRect()
            return {
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
              width: box.width,
              height: box.height,
            }
          }
          const phase = stage.querySelector('.race-phase-track')!
          const guide = phase.nextElementSibling!
          const labels = [...phase.querySelectorAll('li')].map((item) => {
            // Text ranges catch overflowing text, even on the original flex layout.
            const text = item.querySelector('.race-phase-label') ?? item
            const range = document.createRange()
            range.selectNodeContents(text)
            const box = range.getBoundingClientRect()
            return {
              text: text.textContent!.trim(),
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
            }
          })
          return {
            phase: rect(phase),
            guide: rect(guide),
            labels,
            stageRow: rect(stage.querySelector('.race-stage-row')!),
            strip: rect(stage.querySelector('.race-strip')!),
            focus: rect(stage.querySelector('.race-focus')!),
            boards: [...stage.querySelectorAll('.race-live-grid > *')].map(rect),
            guideText: guide.textContent,
            activePhase: phase.querySelector('[aria-current="step"]')?.textContent?.trim(),
            viewport: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
          }
        })
        await info.attach('layout-boxes', {
          body: JSON.stringify(layout, null, 2),
          contentType: 'application/json',
        })
        await info.attach('spectate-layout', {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        })

        expect(layout.documentWidth).toBeLessThanOrEqual(viewport.width)
        expect(layout.labels.map((label) => label.text)).toEqual([
          'START',
          'MID',
          'FINAL CORNER',
          'STRETCH',
          'FINISH',
        ])
        expect(layout.activePhase).toBeTruthy()
        expect(layout.guideText).toMatch(/마번/)
        expect(layout.guideText).toMatch(/순위/)
        // Deliberate breathing room protects actual text ink, not just parent box height.
        expect(layout.guide.top - layout.phase.bottom).toBeGreaterThanOrEqual(12)
        expect(layout.stageRow.top - layout.guide.bottom).toBeGreaterThanOrEqual(12)
        for (const box of [
          layout.phase,
          layout.guide,
          layout.strip,
          layout.focus,
          ...layout.boards,
        ]) {
          expect(box.left).toBeGreaterThanOrEqual(-1)
          expect(box.right).toBeLessThanOrEqual(viewport.width + 1)
        }
        for (const [index, label] of layout.labels.entries()) {
          expect(label.left).toBeGreaterThanOrEqual(layout.phase.left - 1)
          expect(label.right).toBeLessThanOrEqual(layout.phase.right + 1)
          expect(label.top).toBeGreaterThanOrEqual(layout.phase.top - 1)
          expect(label.bottom).toBeLessThanOrEqual(layout.phase.bottom + 1)
          expect(layout.guide.top - label.bottom).toBeGreaterThanOrEqual(12)
          if (index > 0) {
            expect(label.left - layout.labels[index - 1].right).toBeGreaterThanOrEqual(4)
          }
        }
        const overlaps = (a: typeof layout.strip, b: typeof layout.strip) =>
          Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 &&
          Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1
        expect(overlaps(layout.strip, layout.focus)).toBe(false)
        for (const board of layout.boards) {
          expect(overlaps(layout.strip, board)).toBe(false)
          expect(overlaps(layout.focus, board)).toBe(false)
          expect(overlaps(layout.guide, board)).toBe(false)
        }
      })
    }
  }
}
