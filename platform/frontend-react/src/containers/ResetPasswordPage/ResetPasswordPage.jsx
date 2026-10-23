/* eslint-disable */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './ResetPasswordPage.sass';
import ResetPasswordForm from '../../components/ResetPasswordForm/ResetPasswordForm'
import ResetPasswordSent from '../../components/ResetPasswordSent/ResetPasswordSent'
import LoginLayout from "../../layouts/LoginLayout/LoginLayout";
import { requestResetPassword } from '../../requests/Login'
import { useSnackbar } from 'notistack';
import NotificationDuration from 'NotificationDuration';

export default function ResetPasswordPage() {
    const { enqueueSnackbar, closeSnackbar } = useSnackbar();

    const [step , setStep ] = useState(0);
    const [email , setEmail ] = useState('');

    const navigate = useNavigate();

    const onPasswordResetClick = (email) => {
        console.log('onPasswordResetClick for ' + email);
        //api call to send to email
        requestResetPassword({email})
        .then(function (response) {
            setEmail(email);
            setStep(1);
            enqueueSnackbar(`Successfully Sent Password Reset Instructions!`, { variant: 'success', autoHideDuration: NotificationDuration });
        }).catch(function (error) {
            enqueueSnackbar(`Error sending password! (${error})`, { variant: 'error', autoHideDuration: NotificationDuration });
        });
    }

    return (
        <div>
            <LoginLayout
                children={
                    step == 0 ?
                    <ResetPasswordForm
                        goback={() => navigate(-1)}
                        onPasswordResetClick={onPasswordResetClick}
                    />
                    :
                    <ResetPasswordSent userEmail={email} handleClick={() => onPasswordResetClick(email)} />

                }>
            </LoginLayout>

        </div>
    );
}
