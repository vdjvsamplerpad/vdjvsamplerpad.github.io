import type * as React from 'react';

export const isEditableEventTarget = (target: EventTarget | null): boolean => {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  const editable = target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]') as HTMLElement | null;
  if (!editable) return false;
  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    return !editable.readOnly && !editable.disabled;
  }
  if (editable instanceof HTMLSelectElement) {
    return !editable.disabled;
  }
  return true;
};

export const stopEditableKeyPropagation = (event: React.KeyboardEvent): void => {
  if (isEditableEventTarget(event.target)) {
    event.stopPropagation();
  }
};
