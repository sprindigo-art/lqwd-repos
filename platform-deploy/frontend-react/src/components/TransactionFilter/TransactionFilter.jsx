/* eslint-disable */
import React, { useRef } from 'react';
import './TransactionFilter.sass'
import TextField from '@mui/material/TextField';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import CheckboxGroup from '../CheckboxGroup/CheckboxGroup';
import PrimaryOutlineButton from '../Buttons/PrimaryOutline';
import PrimaryButton from '../Buttons/PrimaryButton';
import closeImage from '../../public/icons/general/svg/Close.svg';


export const allTransactionTypes = [{ label: 'Invoice' }, { label: 'Direct' }, { label: 'Fund' }, { label: 'Withdraw' }, { label: 'Fees' }];
export const allTransactionStatus = [{ label: 'Paid' }, { label: 'Unpaid' }, { label: 'Pending' }, { label: 'Expired' }];

export default function TransactionFilter({ nodes, onFilterClicked, onCloseFilter }) {
    let transactionTypes1 = [{ label: 'Spend' }, { label: 'Receive' }];
    let transactionTypes2 = allTransactionTypes;

    const [fromDate, setFromDate] = React.useState(null);
    const [toDate, setToDate] = React.useState(null);
    const [selectedNodes, setSelectedNodes] = React.useState(nodes.map(a => a.label));
    const [transactionSpendReceive, setTransactionSpendReceive] = React.useState(transactionTypes1.map(a => a.label));
    const [transactionType, setTransactionType] = React.useState(transactionTypes2.map(a => a.label));
    const [transactionStatus, setTransactionStatus] = React.useState(allTransactionStatus.map(a => a.label));
    const nodesRef = useRef();
    const transactionTypes1Ref = useRef();
    const transactionTypes2Ref = useRef();
    const transactionStatusRef = useRef();

    const handleChange = (newValue) => {
        setValue(newValue);
    };
    const onChange = (results) => {
        console.log(results)
    }

    const resetAllFilters = () => {
        setToDate(null);
        [nodesRef, transactionTypes1Ref, transactionTypes2Ref, transactionStatusRef].forEach(e => e.current.reset());
        setFromDate(null);
        setSelectedNodes(nodes.map(a => a.label))
        setTransactionSpendReceive(transactionTypes1.map(a => a.label))
        setTransactionType(transactionTypes2.map(a => a.label))
        setTransactionStatus(allTransactionStatus.map(a => a.label))
        onFilterClicked({
            selectedNodes: nodes.map(a => a.label),
            selectedDates: {
                from: null,
                to: null,
            },
            bySpentReceived: [],
            byTransactionType: [],
            byStatus: [],
        });
    }

    const onApplyFilterClicked = () => {
        onFilterClicked({
            selectedNodes,
            selectedDates: {
                from: (fromDate ? new Date(fromDate) : null),
                to: (toDate ? new Date(toDate) : null),
            },
            bySpentReceived: transactionSpendReceive,
            byTransactionType: transactionType,
            byStatus: transactionStatus,
        });
    }



    return (
        <div className='transaction-filter container'>
            <div className="row">

                <div className='my-3 d-flex'> <div className='mx-1' style={{ cursor: 'pointer' }} onClick={() => onCloseFilter()}> <img src={closeImage} /> </div> <h2>Filter</h2></div>

                <div className='mt-3'><h2>Node</h2></div>
                <CheckboxGroup ref={nodesRef} items={nodes} onChange={(res) => setSelectedNodes(res)}></CheckboxGroup>
                <div className='mt-3'><h2>Transaction Types</h2></div>
                <CheckboxGroup ref={transactionTypes1Ref} items={transactionTypes1} onChange={(res) => setTransactionSpendReceive(res)}></CheckboxGroup>
                <hr style={{ borderTop: "1px dashed #B2B2B2" }} />
                <CheckboxGroup ref={transactionTypes2Ref} items={transactionTypes2} onChange={(res) => setTransactionType(res)}></CheckboxGroup>
                <div className='mt-3'><h2>Status</h2></div>
                <CheckboxGroup ref={transactionStatusRef} items={allTransactionStatus} onChange={(res) => setTransactionStatus(res)}></CheckboxGroup>

                <div className='mt-3'><h2>Date</h2></div>
                <LocalizationProvider dateAdapter={AdapterDayjs}>
                    <div className='col-12'><span>From</span></div>
                    <div className='col-12'>
                        <DatePicker
                            label="Select a date"
                            value={fromDate}
                            onChange={(newValue) => {
                                setFromDate(newValue);
                            }}
                            renderInput={(params) => <TextField {...params} />}
                            className='w-100'
                        />
                    </div>

                    <div className='col-12'><span>To</span></div>
                    <div className='col-12'>
                        <DatePicker
                            label="Select a date"
                            value={toDate}
                            onChange={(newValue) => {
                                setToDate(newValue);
                            }}
                            renderInput={(params) => <TextField {...params} />}
                            className='w-100'
                        />
                    </div>
                </LocalizationProvider>
                <div className='d-flex flex-row justify-content-center mt-4'>
                    <PrimaryOutlineButton className='mx-3' text={"Clear all"} onClick={resetAllFilters}></PrimaryOutlineButton>
                    <PrimaryButton className='mx-3' text={"Apply filter"} onClick={onApplyFilterClicked}></PrimaryButton>
                </div>
            </div>
        </div>
    );
}
