import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import ExportSettingsModal from './ExportSettingsModal';

describe('ExportSettingsModal', () => {
  it('should not call onClose twice when clicking outside after saving', () => {
    const onClose = jest.fn();
    const onSave = jest.fn();

    const { rerender } = render(
      <ExportSettingsModal
        isOpen={true}
        onClose={onClose}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByText('Salvar'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <ExportSettingsModal
        isOpen={false}
        onClose={onClose}
        onSave={onSave}
      />
    );

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
