/* eslint-disable */
import React, { useState, useEffect } from 'react';
import './SettingsGeneralInfo.sass'
import { useSelector, useDispatch } from 'react-redux';



const SettingsGeneralInfo = () => {
    let user = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).user_detail;

    if ((process.env.REACT_APP_FEATURES_PROFILE_SETTINGS == 'off')) { return (<></>) }


    return (
        <>
            <div className='settings-general-info m-4'>
                <div className='m-3'>
                    <h1>Profile Settings</h1>
                </div>
                <div className='m-3 d-none d-lg-flex'>
                    <div className="settings-profile-icon rounded-circle mx-3">S</div>
                    <div className='d-flex flex-column justify-content-center'>
                        <div>
                            {`${user.firstName} ${user.lastName}`}
                        </div>
                        <div>
                            Manage your personal information and password
                        </div>
                    </div>
                </div>
            </div>

        </>
    );
};

export default SettingsGeneralInfo;