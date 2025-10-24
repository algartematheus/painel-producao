import React from 'react';

const SummaryCard = ({
    title,
    children,
    className = '',
    titleClassName = 'text-lg font-semibold text-gray-700 dark:text-gray-200',
    contentClassName = 'flex-1 mt-4 space-y-2 text-sm text-gray-600 dark:text-gray-300',
}) => {
    return (
        <div className={`bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-lg h-full flex flex-col ${className}`}>
            {title && (
                <h3 className={titleClassName}>{title}</h3>
            )}
            <div className={contentClassName}>
                {children}
            </div>
        </div>
    );
};

export default SummaryCard;
