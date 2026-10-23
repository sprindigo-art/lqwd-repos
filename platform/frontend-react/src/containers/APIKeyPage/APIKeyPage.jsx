/* eslint-disable */
import './APIKeyPage.sass';
import React, { useEffect, useState } from "react";
import APIKeyConfirmPassword from './APIKeyConfirmPassword'
import APIKeyDeactivateConfirmPassword from './APIKeyDeactivateConfirmPassword'
import PrimaryButton from "../../components/Buttons/PrimaryButton";
import CopyText from "../../components/CopyText/CopyText";
import NotificationDuration from 'NotificationDuration'
import { useSnackbar } from 'notistack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import TrashImg from 'public/icons/general/png/Trash.png';
import CopyImg from 'public/icons/general/png/Copy.png';
import Tooltip from "react-bootstrap/Tooltip";
import { OverlayTrigger } from "react-bootstrap";
import { setAPIKey } from './APIKeyPageActions'
import { useSelector, useDispatch } from 'react-redux';

import { requestGenerateNewAPIKeys, requestGetListOfAPIKeys, requestGetTotalRequestsForKey, requestDeactivateKey } from 'requests/APIKey'


const APIKeyPage = () => {

    const { enqueueSnackbar, closeSnackbar } = useSnackbar();
    const dispatch = useDispatch();

    const [modalState, setModalState] = useState({
        show: false,
        apikey2delete: '',
    });

    const [generateModalState, setGenerateModalState] = useState({
        show: false,
        createdAPI: '',
    });

    const allAPIKeys = useSelector(state => state.APIKeyPageReducer.allAPIKeys);

    const [allRequestCounts, setAllRequestCounts] = useState({});

    const generateAPIKey = (password) => {

        requestGenerateNewAPIKeys({ password })
            .then(function (response) {
                if (response.status != 200) {
                    enqueueSnackbar(`Error occured when generating API key! ${JSON.parse(response.error).message ? JSON.parse(response.error).message : ''}`, { variant: 'error', autoHideDuration: NotificationDuration });
                    setGenerateModalState({ show: false, createdAPI: '' })
                } else {
                    setGenerateModalState({ show: false, createdAPI: JSON.parse(response.object).apikey })
                    enqueueSnackbar('Successfully generated API key', { variant: 'success', autoHideDuration: NotificationDuration });
                    getAllAPIKeys();
                }

            }).catch(function (error) {
                enqueueSnackbar('Error occured when generating API key!', { variant: 'error', autoHideDuration: NotificationDuration });
                setGenerateModalState({ show: false, createdAPI: '' })
            });
    }
    const deactivateAPIKey = (password) => {
        let { apikey2delete } = modalState;

        requestDeactivateKey({ apikey: apikey2delete, password })
            .then(function (response) {
                if (response.status != 200) {
                    enqueueSnackbar(`Error occured when deactivating API key! ${JSON.parse(response.error).apikey ? JSON.parse(response.error).apikey : ''}`, { variant: 'error', autoHideDuration: NotificationDuration });
                } else {
                    enqueueSnackbar('Successfully deactivated API key', { variant: 'success', autoHideDuration: NotificationDuration });
                    getAllAPIKeys();
                }
                setModalState({ show: false, apikey2delete: '' })

            }).catch(function (error) {
                enqueueSnackbar('Error occured when deactivating API key!', { variant: 'error', autoHideDuration: NotificationDuration });
                setModalState({ show: false, apikey2delete: '' })
            });
    }


    const insertAPIKeys = (rawData) => {
        //sort by creation date
        rawData = rawData.sort(function (a, b) { return new Date(b.created) - new Date(a.created) });
        let t = [];
        rawData.forEach((item) => {
            let i = {};
            i.APIKey = item.apikey;
            i.CreatedTime = item.created;
            i.Status = item.status;
            t.push(i);
        });

        dispatch(setAPIKey(t));
    }

    const getAllAPIKeys = () => {
        requestGetListOfAPIKeys()
            .then(function (response) {
                let allkeys = JSON.parse(JSON.parse(response.object).apikey);
                insertAPIKeys(allkeys);
            }).catch(function (error) {
                console.log(error);
            });
    }


    useEffect(() => {
        // Update the document title using the browser API
        document.title = `LQWD | API Key`;
        getAllAPIKeys();

    }, []);

    const renderStatus = (status) => {
        return (
            <div>
                <div className={'apikey-status apikey-status-' + (status.toLowerCase())}>
                    {status}
                </div>

            </div>
        )
    }

    const confirmGenerateKey = () => {
        setGenerateModalState({ show: true, createdAPI: '' })
    }

    const [showCopied, setShowCopied] = useState(-1);

    function copyAPIKey(APIKey, index) {
        navigator.clipboard.writeText(APIKey).then(r => {
            setShowCopied(index)
            setTimeout(function () { setShowCopied(-1); }, 300)
        }
        )
    }

    const renderTooltip = props => (
        <Tooltip {...props} id="copy-tooltip">Copied</Tooltip>
    );

    const renderActions = (APIKey, status, index) => {
        let style;
        if (status.toLowerCase() == 'active') {
            style = { cursor: 'pointer' }
        } else {
            style = {
                pointerEvents: 'none',
                opacity: 0.4,
            }
        }
        return (
            <div className='d-flex'>
                <OverlayTrigger placement="top" show={showCopied == index} overlay={renderTooltip}>
                        <div style={style} onClick={() => copyAPIKey(APIKey,index)}><img src={CopyImg} alt="" /></div>
                </OverlayTrigger>
                <div style={style} onClick={() => { setModalState({ show: true, apikey2delete: APIKey }) }}><img src={TrashImg} alt="" /></div>
            </div>
        )
    }

    return (
        <div className="apikey p-3">
            <div className='py-1'>
                <h1>API Key</h1>
            </div>
            <div className='py-1'>
                <PrimaryButton text='Generate API Key' onClick={confirmGenerateKey}></PrimaryButton>
            </div>
            <div className='py-1'>
                <CopyText text={generateModalState.createdAPI} classNames='w-100' />
            </div>
            <hr style={{ borderTop: 'dotted 1px #B2B2B2' }} />
            <div className='py-1'>
                <h1>Existing API Keys</h1>
            </div>
            <div>
                <TableContainer component={Paper}>
                    <Table sx={{ minWidth: 650 }} aria-label="simple table">
                        <TableHead>
                            <TableRow>
                                <TableCell align="left">API Key</TableCell>
                                <TableCell align="left">Requests</TableCell>
                                <TableCell align="left">Status</TableCell>
                                <TableCell align="left">Creation Date</TableCell>
                                <TableCell align="left">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {allAPIKeys.map((row, index) => (
                                <TableRow
                                    key={row.APIKey}
                                    sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                                >
                                    <TableCell component="th" scope="row">
                                        {row.APIKey.substring(0, 60) + '...'}
                                    </TableCell>
                                    <TableCell align="left">{allRequestCounts[row.APIKey] != null ? allRequestCounts[row.APIKey] : 'loading'}</TableCell>
                                    <TableCell align="left">{renderStatus(row.Status)}</TableCell>
                                    <TableCell align="left">{row.CreatedTime}</TableCell>
                                    <TableCell align="left">{renderActions(row.APIKey, row.Status, index)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </div>
            <APIKeyConfirmPassword
                onHide={() => setGenerateModalState({ show: false, createdAPI: '' })}
                onConfirm={(password) => generateAPIKey(password)}
                show={generateModalState.show}
            />
            <APIKeyDeactivateConfirmPassword
                onHide={() => setModalState({ show: false, apikey2delete: '' })}
                onConfirm={(password) => deactivateAPIKey(password)}
                show={modalState.show}
            />

        </div>
    );
};

export default APIKeyPage;

