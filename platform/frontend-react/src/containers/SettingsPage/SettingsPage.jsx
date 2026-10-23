/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useSnackbar } from 'notistack';
import NotificationDuration from 'NotificationDuration'
import { changeHeaderPage } from '../../components/Header/HeaderActions'
import TextField from '@mui/material/TextField';
import MuiPhoneNumber from 'material-ui-phone-number';
import PrimaryButton from "../../components/Buttons/PrimaryButton";
import BlockUi from 'react-block-ui';
import { getUserInfo, updateUserInfo } from '../../requests/Login'

const SettingsPage = () => {

    if ((process.env.REACT_APP_FEATURES_PROFILE_SETTINGS == 'off')) { return (<></>) }


    let user = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).user_detail;
    const { enqueueSnackbar, closeSnackbar } = useSnackbar();
    const [value, setValue] = useState({});
    const [initialValue, setInitialValue] = useState({});
    const [loading, setLoading] = useState(true);

    const dispatch = useDispatch();

    const onUpdate = () => {
        updateUserInfo(value)
            .then(function (response) {
                if (response.status != 200) {
                    enqueueSnackbar(`Error occured when setting user info! ${JSON.parse(response.error).message ? JSON.parse(response.error).message : ''}`, { variant: 'error', autoHideDuration: NotificationDuration });

                } else {
                    enqueueSnackbar('Successfully updated user data', { variant: 'success', autoHideDuration: NotificationDuration });

                }

            }).catch(function (error) {
                enqueueSnackbar('Error occured when setting user info!', { variant: 'error', autoHideDuration: NotificationDuration });

            });
    }

    useEffect(() => {
        dispatch(changeHeaderPage('Settings_Profile'));
        getUserInfo()
            .then(function (response) {
                if (response.status != 200) {
                    enqueueSnackbar(`Error occured when getting user info! ${JSON.parse(response.error).message ? JSON.parse(response.error).message : ''}`, { variant: 'error', autoHideDuration: NotificationDuration });

                } else {
                    let resp = JSON.parse(response.object);
                    let data = {
                        firstName: resp.firstName,
                        lastName: resp.lastName,
                        email: resp.email,
                        username: resp.username,
                        phone: resp.phone,
                    }
                    setInitialValue(data);
                    setValue(data);
                    setLoading(false);
                    //enqueueSnackbar('Successfully generated API key', { variant: 'success', autoHideDuration: NotificationDuration });

                }

            }).catch(function (error) {
                enqueueSnackbar('Error occured when getting user info!', { variant: 'error', autoHideDuration: NotificationDuration });

            });

    }, []);

    return (
        <>
            <BlockUi tag="div" blocking={loading}>
                <div className='mx-3'>
                    <TextField
                        fullWidth
                        margin="normal"
                        id="outlined-read-only-input"
                        label="Email Address"
                        value={value.email || ''}
                        variant="standard"
                        InputProps={{
                            readOnly: true,
                        }}
                    />
                    {/* <TextField
                        fullWidth
                        margin="normal"
                        id="outlined-read-only-input"
                        label="User Name"
                        defaultValue={value.username || ''}
                        variant="standard"
                        InputProps={{
                            readOnly: true,
                        }}
                    // onChange={(newVal) => setValue({...value,username: newVal})}
                    /> */}
                    <TextField
                        fullWidth
                        margin="normal"
                        id="outlined-read-only-input"
                        label="First Name"
                        defaultValue={value.firstName || ''}
                        InputProps={{
                            readOnly: false,
                        }}
                        onChange={(newVal) => setValue({ ...value, firstName: newVal.target.value })}
                    />
                    <TextField
                        fullWidth
                        margin="normal"
                        id="outlined-read-only-input"
                        label="Last Name"
                        defaultValue={value.lastName || ''}
                        InputProps={{
                            readOnly: false,
                        }}
                        onChange={(newVal) => setValue({ ...value, lastName: newVal.target.value })}
                    />
                    <div>
                        <div>Phone Number</div>
                        <div>
                            <MuiPhoneNumber value={value.phone} defaultCountry={'ca'} onChange={(newVal) => setValue({ ...value, phone: newVal })} />
                        </div>

                    </div>
                </div>
                <div className='mt-5 d-flex flex-row justify-content-end'>

                    <PrimaryButton text='Save' disabled={initialValue == value} onClick={onUpdate}></PrimaryButton>
                </div>
            </BlockUi>
        </>
    );
};

export default SettingsPage;