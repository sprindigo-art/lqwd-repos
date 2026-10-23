/* eslint-disable */
import {
  REQUEST_ACCOUNTING_GET_API_KEY_HISTORY,
  REQUEST_ACCOUNTING_GET_API_KEYS,
  REQUEST_ACCOUNTING_GET_API_KEYS_FAIL,
  REQUEST_ACCOUNTING_GET_API_KEYS_SUCCESS
} from "./RequestAccountingConstants";

export function getApiKeys(){
  return { type: REQUEST_ACCOUNTING_GET_API_KEYS };
}

export function getApiKeysSuccess(response){
  return { type: REQUEST_ACCOUNTING_GET_API_KEYS_SUCCESS, payload: { response } };
}

export function getApiKeysFail(error){
  return { type: REQUEST_ACCOUNTING_GET_API_KEYS_FAIL, payload: { error} };
}

export function getApiHistoryByKey(apikey, size, page){
  return { type: REQUEST_ACCOUNTING_GET_API_KEY_HISTORY, payload: { apikey, size, page }};
}

export function getApiHistoryByKeySuccess(response){
  return { type: REQUEST_ACCOUNTING_GET_API_KEY_HISTORY, payload: { response }};
}

export function getApiHistoryByKeyFail(error){
  return { type: REQUEST_ACCOUNTING_GET_API_KEY_HISTORY, payload: { error }};
}