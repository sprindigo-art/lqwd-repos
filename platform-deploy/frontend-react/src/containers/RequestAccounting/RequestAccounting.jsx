/* eslint-disable */
import './RequestAccounting.css';
import React, { useEffect, useState } from "react";
import RequestHistoryTable from "../../components/RequestHistoryTable/RequestHistoryTable";
import PageButtons from "../../components/PageButtons/PageButtons";
import { Form } from "react-bootstrap";
import PrimaryButton from "../../components/Buttons/PrimaryButton";
import SearchField from "../../components/SearchField/SearchField";
import { getApiHistoryByKey, getApiKeys } from "./RequestAccountingActions";
import { useDispatch, useSelector } from "react-redux";
import { requestApiKeyHistory } from "../../requests/RequestAccounting";

const RequestAccounting = () => {

  const requestAccountingState = useSelector(state => state.requestAccountingReducer);

  const dispatch = useDispatch();

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

  const [selectedApiKey, setSelectedApiKey] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  const [totalRequests, setTotalRequests] = useState(0);

  const [apiKeyRequests, setApiKeyRequests] = useState([])

  const selectOnChange = (event) => {
    console.log(event.target.value);
    setSelectedApiKey(event.target.value);
  };

  const onApiSubmit = () => {
    requestApiKeyHistory({apikey: selectedApiKey, page: 0, size: 10})
    .then(function(response) {
        console.log(response);
        setTotalRequests(response.totalElements);
        setTotalPages(response.totalPages);
        setApiKeyRequests(response.content);
    }).catch(function(error){
      console.log(error);
    });
  };

  const onPageChange = (page, size) => {
    console.log(page, size);
    setCurrentPage(page);
    requestApiKeyHistory({apikey: selectedApiKey, page: page-1, size: 10})
      .then(function(response) {
        console.log(response);
        setApiKeyRequests(response.content);
      }).catch(function(error){
      console.log(error);
    });
  };

  useEffect(() => {
    dispatch(getApiKeys());
    document.title = `LQwD | Request Accounting`;
  }, []);

  return (
      <div className="">
        <div className="request-accounting-container">
          <div className="request-accounting-header-container">
            <div className="request-accounting-header">
              Request Accounting
            </div>
            <div className="row">
              <div className="col-10">
                <Form.Select aria-label="Default select example" onChange={selectOnChange}>
                  <option selected disabled value="" >{"Select API Key"}</option>
                  {requestAccountingState.apiKeys.length > 0 ?

                    requestAccountingState.apiKeys.map((item, num) => (
                      <option key={num} value={item.apikey} >{item.apikey}</option>
                    ))
                    :
                    <></>
                  }
                </Form.Select>
              </div>
              <div className="col-2">
                <PrimaryButton className={"w-100"} text={"Submit"} onClick={() => onApiSubmit()}></PrimaryButton>
              </div>
            </div>
          </div>
          <div className="request-account-line"></div>
          <div className="request-accounting-table">
            <div className="request-accounting-table-row">
              <div className="request-accounting-table-header-row">
                <div className="request-accounting-table-header">
                  Request History
                </div>
                <div className="request-accounting-table-header">
                  All Requests: {totalRequests}

                </div>
              </div>
              <div className="request-accounting-search">
                <SearchField id={"search-field"}
                             name={"search-field"}
                             placeholder={"Search Requests"}
                             resultList={[]}>

                </SearchField>
              </div>
            </div>

            {apiKeyRequests.length > 0 ?
              <>
                <RequestHistoryTable paginatedRequestHistory={apiKeyRequests}></RequestHistoryTable>
                <PageButtons currentPage={currentPage} totalPages={(totalPages === 0) ? 1 : totalPages} handlePageChange={onPageChange}></PageButtons>
              </>
              :
              <></>
            }

          </div>
        </div>
      </div>
  );
};

export default RequestAccounting;

