import React from 'react';
import ResetPasswordForm from './ResetPasswordForm';

export default {
    title: 'Components/Reset Password Form',
    component: ResetPasswordForm,
};

export const primary = () => {
    return (
        <div>
            <ResetPasswordForm />
        </div>
    );
};
