/* eslint-disable */
import './TransactionDetails.sass';
import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Modal } from 'react-bootstrap';
import { hideTransactionDetails } from './TransactionDetailsActions'
import PrimaryButton from "../../components/Buttons/PrimaryButton";
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Tooltip from "react-bootstrap/Tooltip";
import { OverlayTrigger } from "react-bootstrap";

function CopyElement({text,label}) {
    const [show, setShow] = useState(false);
    const renderTooltip = props => (
        <Tooltip {...props} id="copy-tooltip">Copied</Tooltip>
    );

    function copy(text) {
        navigator.clipboard.writeText(text).then(r => {
            setShow(true)
            setTimeout(function () { setShow(false); }, 1000)
        })
    }

    return (
        <OverlayTrigger placement="top" show={show} overlay={renderTooltip}>
            <TextField
                fullWidth
                margin="normal"
                label={label}
                id={label}
                InputProps={{
                    endAdornment: (
                        <InputAdornment position="start">
                            <ContentCopyIcon onClick={() => copy(text)} />
                        </InputAdornment>
                    ),
                }}
                value={text} />
        </OverlayTrigger>
    )
}

export default function TransactionDetails() {

    const transactionDetailsReducer = useSelector(state => state.transactionDetailsReducer);
    const { showModal, transaction } = transactionDetailsReducer;
    if (!transaction) {
        return (<></>);
    }

    const dispatch = useDispatch();

    const renderType = (t, isReceived) => {
        let type = t;
        if (type == 'transaction') {
            type = isReceived ? 'fund' : 'withdraw';
        }
        return (
            <div>
                <div className={'transaction-type transaction-type-' + (type.toLowerCase() == 'closing fee' ? 'fees' : type.toLowerCase())}>
                    {type}
                </div>
            </div>
        )
    }
    const renderStatus = (status) => {
        return (
            <div>
                <div className={'transaction-status transaction-status-' + (status.toLowerCase())}>
                    {status}
                </div>

            </div>
        )
    }

    return (
        <Modal centered size='lg' className="transaction-details" show={showModal} onHide={() => { dispatch(hideTransactionDetails()) }} backdrop='static' keyboard="False">
            <Modal.Header closeButton className="mx-2">
                <div className='d-flex'>
                    <div><h1>Transaction Details</h1></div>
                </div>
            </Modal.Header>
            <Modal.Body className="mx-2">
                <h1>{transaction.node}</h1>
                <div className='d-flex'>
                    <div className='flex-grow-1 d-flex'>
                        {renderType(transaction.type.toLowerCase(), transaction.amount > 0)}
                        <div className='mx-2'>{renderStatus(transaction.state.toLowerCase())}</div>
                    </div>
                    <div><span style={{ fontWeight: 'bold' }}>{transaction.created.split('T')[0]}</span></div>
                </div>
                <CopyElement text={transaction.id} label={"ID"} ></CopyElement>
                <CopyElement text={transaction.trxId} label={"Transaction ID"} ></CopyElement>

                <div className='my-2'>
                    <PrimaryButton text='Got it' onClick={() => { dispatch(hideTransactionDetails()) }}></PrimaryButton>
                </div>
            </Modal.Body>
        </Modal>
    );
}
