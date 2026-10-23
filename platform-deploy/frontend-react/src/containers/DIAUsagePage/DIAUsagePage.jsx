/* eslint-disable */
import './DIAUsagePage.scss';
import React, { useEffect, useState } from "react";
import SwaggerUI from "swagger-ui-react"
import "swagger-ui-react/swagger-ui.css"
import swagger_json from './swagger'
import PrettyJSONViewPlugin from './PrettyJSONViewPlugin'

const MyWrapBuiltinComponentPlugin = function (system) {
  return {
    wrapComponents: {
      info: (Original, system) => (props) => {
        return <div>
          <h3>Hello world! I am above the Info component.</h3>
          <Original {...props} />
        </div>
      }
    }
  }
}
function UrlParamDisablePlugin() {
  return {
    statePlugins: {
      spec: {
        wrapActions: {
          // Remove the ?url parameter from loading an external OpenAPI definition.
          updateUrl: (oriAction) => (payload) => {
            const url = new URL(window.location.href)
            if (url.searchParams.has('url')) {
              url.searchParams.delete('url')
              window.location.replace(url.toString())
            }
            return oriAction(payload)
          }
        }
      }
    }
  }
}

const DIAUsagePage = () => {
  let newToken = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
  let source = {};
  //either use spec to pass json vairable or url
  if (process.env.REACT_APP_ENVIRONMENT == 'development' 
   || process.env.REACT_APP_ENVIRONMENT == 'staging' 
   || process.env.REACT_APP_ENVIRONMENT == 'production'){
    source = {url:'/swagger.json'}
  }else{
    source = {spec: swagger_json}
  }

  return (
    <div className="">
      {
        process.env.REACT_APP_FEATURES_SUPPORT_DIA_USAGE === 'on'?
        <SwaggerUI
          {...source}
          requestInterceptor={(req) => {
            req.headers.Authorization = `Bearer ${newToken}`;
  
            return req;
          }}
          plugins={[
            PrettyJSONViewPlugin
          ]}
        />
        :<></>

      }
    </div>
  );
};

export default DIAUsagePage;

