/* eslint-disable */
import React from 'react';
import './TransactionTable.sass'
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import RightImage from '../../public/icons/transactions/CircledRight.svg'
import LeftImage from '../../public/icons/transactions/CircledLeft.svg'
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CopyText from "../CopyText/CopyText";



export default function TransactionTable({ transactions, currency, pageSize, currentPage, showTransactionDetails }) {
    let start = (currentPage - 1) * pageSize;
    let end = Math.min(currentPage * pageSize, transactions.length);
    const paginatedTransactions = transactions.slice(start, end);

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

    const rowSelected = (row) => {
        showTransactionDetails(row.TransactionID)
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
    const renderAmount = (amount, isReceived) => {

        return (
            <div className='TransactionTable-Amount'>
                {isReceived ? <img src={RightImage} /> : <img src={LeftImage} />}
                <span>{amount * currency.rate}</span><span>{currency.code}</span>
            </div>
        )
    }



    const capitalizeFirst = (str) => {
        return str.charAt(0).toUpperCase() + str.slice(1);
    };

    return (
        <div className='transaction-table container'>
            <TableContainer component={Paper} className='d-none d-lg-block'>
                <Table sx={{ minWidth: 650 }} aria-label="simple table">
                    <TableHead>
                        <TableRow>
                            <TableCell align="left">Node</TableCell>
                            <TableCell align="left">Transaction ID</TableCell>
                            <TableCell align="left">Type</TableCell>
                            <TableCell align="left">Status</TableCell>
                            <TableCell align="left">Time</TableCell>
                            <TableCell align="left">Amount</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {paginatedTransactions.map((row) => (
                            <TableRow
                                key={row.TransactionID}
                                sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                                hover={true}
                                onClick={() => rowSelected(row)}
                            >
                                <TableCell component="th" scope="row">
                                    {row.Node}
                                </TableCell>
                                <TableCell align="left">{row.TransactionID}</TableCell>
                                <TableCell align="left">{renderType(row.Type, row.isReceived)}</TableCell>
                                <TableCell align="left">{renderStatus(row.Status)}</TableCell>
                                <TableCell align="left">{row.Time}</TableCell>
                                <TableCell align="left">{renderAmount(row.Amount, row.isReceived)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
            <div className="d-lg-none" style={{ paddingBottom: '100px' }}>
                {transactions.map((row) => (
                    <Accordion>
                        <AccordionSummary
                            expandIcon={<ExpandMoreIcon />}
                            aria-controls="panel1a-content"
                            id="panel1a-header"
                        >
                            <div className='container'>
                                <div className='row'>
                                    <Typography><h2>{row.Node}</h2></Typography>
                                </div>
                                <div className='row text-end'>
                                    {renderAmount(row.Amount, row.isReceived)}
                                </div>
                                <div className='d-flex flex-row'>
                                    <div >{renderType(row.Type)}</div>
                                    <div>{renderStatus(row.Status)}</div>
                                    <div className='flex-grow-1 text-end my-auto' style={{ fontSize: '12px' }}> {row.Time} </div>
                                </div>

                            </div>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Typography>
                                <Divider />
                                <div><span style={{color:'rgba(122, 122, 122, 1)', font:'600'}}>{capitalizeFirst(row.Type)} ID</span></div>
                                <div className={"overflow-hidden"}><span style={{color:'rgba(122, 122, 122, 1)', font:'400'}}>
                                   <CopyText text={row.TransactionID}/>
                                </span></div>
                            </Typography>
                        </AccordionDetails>
                    </Accordion>
                ))}

            </div>
        </div>
    );
}
