/* eslint-disable */
import request, { isValidUrl } from "../utils/request";

let baseURL = process.env.REACT_APP_DLA_BASE_URL;
if (!isValidUrl(baseURL)) {
    //path relative to current origin
    baseURL = window.location.origin + baseURL;
}

export function requestGetAllInvoices(action) {
    // const { payload } = action;
    // let startDate = payload.startDate;
    // let endDate = payload.endDate;
    //TODO: get start and end date from customer, for now, long time ago as start and long time ahead as end time
    //note that data format should be like DD-MM-YYYY
    let startDate = '01-01-2020';
    let endDate = '01-01-2025';

    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    return request(`${baseURL}/api/v1/transactions/all?pageNumber=${0}&pageSize=${1000000000}&startDate=${startDate}&endDate=${endDate}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`
        },
    });
}