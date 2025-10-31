import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_EXPORT_SETTINGS, useClickOutside } from '../modules/shared';

const ExportSettingsModal = ({ isOpen, onClose, settings = DEFAULT_EXPORT_SETTINGS, onSave }) => {
    const [localSettings, setLocalSettings] = useState(() => ({ ...DEFAULT_EXPORT_SETTINGS }));
    const modalRef = useRef(null);
    const handleRequestClose = useCallback((event) => {
        if (!isOpen) return;
        if (typeof onClose === 'function') {
            onClose(event);
        }
    }, [isOpen, onClose]);
    useClickOutside(modalRef, handleRequestClose, isOpen);

    useEffect(() => {
        if (isOpen) {
            setLocalSettings({
                ...DEFAULT_EXPORT_SETTINGS,
                ...(settings || {}),
            });
        }
    }, [isOpen, settings]);

    if (!isOpen) return null;

    const handleCheckboxChange = (key) => {
        setLocalSettings(prev => ({
            ...prev,
            [key]: !prev[key],
        }));
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        if (typeof onSave === 'function') {
            onSave({ ...localSettings });
        }
        if (isOpen) {
            handleRequestClose();
        }
    };

    const checkboxOptions = [
        { key: 'dailySummary', label: 'Resumo do dia' },
        { key: 'monthlySummary', label: 'Resumo mensal' },
        { key: 'periodDetails', label: 'Detalhamento por período' },
        { key: 'completedLots', label: 'Lotes concluídos' },
        { key: 'activeLots', label: 'Lotes ativos' },
    ];

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-30 modal-backdrop">
            <div ref={modalRef} className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md modal-content">
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <h2 className="text-xl font-bold mb-2">Configurações de Exportação</h2>
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                            Escolha quais seções devem ser incluídas no relatório exportado.
                        </p>
                    </div>
                    <div className="space-y-3">
                        {checkboxOptions.map(option => (
                            <label key={option.key} className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="form-checkbox h-5 w-5 text-blue-600"
                                    checked={Boolean(localSettings[option.key])}
                                    onChange={() => handleCheckboxChange(option.key)}
                                />
                                <span className="text-sm text-gray-800 dark:text-gray-100">{option.label}</span>
                            </label>
                        ))}
                    </div>
                    <div className="flex justify-end gap-4">
                        <button
                            type="button"
                            onClick={(event) => handleRequestClose(event)}
                            className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-600"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 rounded-md bg-blue-600 text-white"
                        >
                            Salvar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ExportSettingsModal;
