import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Put this on EVERY `<input type="number">`.
 *
 * A focused number input treats the mouse wheel as its stepper, so scrolling
 * the page with the cursor still over the field silently changes the value by
 * `step` per notch, with no keystroke and nothing on screen to notice. On a
 * long form that is not a rare accident: you type the number, scroll down to
 * reach Save, and save a different number than you typed. It cost us a real
 * one, a job's salary gate stored as 149999 after 150000 was typed.
 *
 * Blurring is the fix rather than `e.preventDefault()`, because React attaches
 * `wheel` as a PASSIVE listener at the root, so preventDefault inside `onWheel`
 * is ignored (and warns). An unfocused number input does not step, so dropping
 * focus stops it. The page still scrolls, which is what the user meant.
 */
export const blurOnWheel = (e: React.WheelEvent<HTMLInputElement>) => {
  e.currentTarget.blur()
}
