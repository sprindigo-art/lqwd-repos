/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import Password from "../../components/Basic/Password";
import PrimaryButton from "../../components/Buttons/PrimaryButton";
import { changeHeaderPage } from '../../components/Header/HeaderActions'
import PasswordChecklist from "react-password-checklist";
import { changePassword } from '../../requests/Login'
import { useSnackbar } from 'notistack';
import NotificationDuration from 'NotificationDuration'

const SettingsPassword = () => {

    if ((process.env.REACT_APP_FEATURES_PROFILE_SETTINGS == 'off')) { return (<></>) }

    let passwordRules = ["minLength", "specialChar", "number", "capital", "match"]

    const [oldPassword, setOldPassword] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isDisabled, setIsDisabled] = useState(true);
    const { enqueueSnackbar, closeSnackbar } = useSnackbar();

    const onUpdate = (oldPass, newPass) => {
        changePassword({ oldPassword: oldPass, newPassword: newPass })
            .then(function (response) {
                if (response.status != 200) {
                    enqueueSnackbar(`Error occured when changing password! ${JSON.parse(response.error).message ? JSON.parse(response.error).message : ''}`, { variant: 'error', autoHideDuration: NotificationDuration });

                } else {
                    enqueueSnackbar('Successfully changed password', { variant: 'success', autoHideDuration: NotificationDuration });

                }

            }).catch(function (error) {
                enqueueSnackbar('Error occured when changing password!', { variant: 'error', autoHideDuration: NotificationDuration });

            });
    }

    const dispatch = useDispatch();
    useEffect(() => {
        dispatch(changeHeaderPage('Settings_Password'));
    }, []);


    return (
        <>
            <div className='container my-3'>
                <div className="row">
                    <div className="col-12 col-md-6 col-lg-7 col-xl-8">
                        <div className="settings-page-form-inputs">
                            <label className="settings-page-form-label">Current Password*</label>
                            <Password className="" type="password"
                                id="password"
                                name="password"
                                onChange={(value) => setOldPassword(value)} />
                        </div>
                        <div className="settings-page-form-inputs">
                            <label className="settings-page-form-label1">New Password*</label>
                            <Password className="" type={password.length == 0 ? 'text' : "password"}
                                id="password"
                                name="password"
                                autoComplete='new-password'
                                onChange={(value) => setPassword(value)} />
                        </div>
                        <div className="settings-page-form-inputs">
                            <label className="settings-page-form-label2">Confirm New Password*</label>
                            <Password className="" type="password"
                                id="confirmPassword"
                                name="confirmPassword"
                                autoComplete='new-password'
                                onChange={(value) => setConfirmPassword(value)} />

                        </div>
                        <div className='d-flex justify-content-end flex-row  my-3'>
                            <PrimaryButton disabled={isDisabled} id="register-btn" text="Save" onClick={() => onUpdate(oldPassword, password)}></PrimaryButton>
                        </div>
                    </div>
                    <div className="col-12 col-md-6 col-lg-5 col-xl-4">
                        <div className='mb-1'>The new password Should fulfill these rules:</div>
                        <PasswordChecklist
                            rules={[...passwordRules]}
                            minLength={6}
                            value={password}
                            valueAgain={confirmPassword}
                            onChange={(isValid) => { setIsDisabled(!isValid); }}
                            style={{
                                position: 'relative',
                                backgroundColor: "#FFF",
                                zIndex: "999",
                                borderRadius: "16px",
                            }}
                        />
                    </div>
                </div>

            </div>
        </>
    );
};

export default SettingsPassword;