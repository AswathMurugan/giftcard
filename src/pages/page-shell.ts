/**
 * The shared page measure.
 *
 * Every feature page uses this one container class so widths can't drift apart
 * as pages are added — changing the measure here changes it everywhere.
 *
 * Full width: the content box fills whatever space the rail leaves, with only
 * the page gutter reserved. No `mx-auto` (content sits against the rail rather
 * than floating mid-screen) and no max-width cap, so wide monitors are used
 * rather than left empty.
 */
export const PAGE_CONTAINER = 'w-full px-7 pb-20 pt-8';
