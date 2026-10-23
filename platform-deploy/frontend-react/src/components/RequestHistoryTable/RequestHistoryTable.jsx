/* eslint-disable */
import React, { useState } from "react";
import './RequestHistoryTable.css';
import TableContainer from "@mui/material/TableContainer";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableCell from "@mui/material/TableCell";
import TableBody from "@mui/material/TableBody";
import Moment from 'moment';

export default function RequestHistoryTable({paginatedRequestHistory}){

  return (
    <>
      <div className='request-history-table'>
        <TableContainer component={Paper}>
          <Table sx={{ minWidth: 650 }} aria-label="simple table">
            <TableHead>
              <TableRow>
                <TableCell align="left">Request Topic</TableCell>
                <TableCell align="left">API Key</TableCell>
                <TableCell align="left">Request Date</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paginatedRequestHistory.map((row) => (
                <TableRow
                  key={row.id}
                  sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                >
                  <TableCell component="th" scope="row">{row.command}</TableCell>
                  <TableCell component="th" scope="row">{row.apikey}</TableCell>
                  <TableCell align="left">{Moment(row.date).format('MMM D YYYY HH:mm:ss Z')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
    </>
  );
}