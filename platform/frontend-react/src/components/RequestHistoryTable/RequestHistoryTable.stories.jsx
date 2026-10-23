import React from 'react';
import RequestHistoryTable from "./RequestHistoryTable";

export default {
  title: 'Components/Request History Table',
  component: RequestHistoryTable,
};

export const primary = ({...args}) => {

  const paginatedRequestHistory =  [
    {
      "id": 260974,
      "apikey": "598b5a4455a708cb5329defcf946c81099782b1c8b1402ca3f0a0f109b7417b080ebad6e77deb1730a6a77979ef9436d4692d9d4a17a3f2fc2ea86ef47a3a0c0",
      "command": "v1/getinfo",
      "date": "2022-11-02T23:12:14.283+00:00"
    },
    {
      "id": 260976,
      "apikey": "598b5a4455a708cb5329defcf946c81099782b1c8b1402ca3f0a0f109b7417b080ebad6e77deb1730a6a77979ef9436d4692d9d4a17a3f2fc2ea86ef47a3a0c0",
      "command": "v1/getinfo",
      "date": "2022-11-02T23:12:15.331+00:00"
    },
    {
      "id": 260978,
      "apikey": "598b5a4455a708cb5329defcf946c81099782b1c8b1402ca3f0a0f109b7417b080ebad6e77deb1730a6a77979ef9436d4692d9d4a17a3f2fc2ea86ef47a3a0c0",
      "command": "v1/getinfo",
      "date": "2022-11-02T23:12:16.129+00:00"
    }
  ];

  return (
      <>
        <RequestHistoryTable paginatedRequestHistory={paginatedRequestHistory}/>
      </>
  )
}