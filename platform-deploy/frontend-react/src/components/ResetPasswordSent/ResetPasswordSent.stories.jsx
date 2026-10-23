import React from 'react';
import ResetPasswordSent from './ResetPasswordSent';

export default {
    title: 'Components/Reset Password Sent',
    component: ResetPasswordSent,
};

export const primary = () => {
    return (
        <div>
            <ResetPasswordSent userEmail='user@lqwd.tech' />
        </div>
    );
};
