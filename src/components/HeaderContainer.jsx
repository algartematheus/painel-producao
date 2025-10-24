import React from 'react';

const HeaderContainer = ({ children, className = '', sticky = true, zIndexClass = 'z-20' }) => {
    const baseClasses = 'bg-white dark:bg-gray-900 shadow-md p-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between';
    const stickyClasses = sticky ? `sticky top-0 ${zIndexClass}` : '';
    const composedClassName = [baseClasses, stickyClasses, className].filter(Boolean).join(' ');

    return (
        <header className={composedClassName}>
            {children}
        </header>
    );
};

export default HeaderContainer;
