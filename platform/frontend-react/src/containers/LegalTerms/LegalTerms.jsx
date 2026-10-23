/* eslint-disable */
import React, { useEffect, useState } from "react";
import TermsContainer from "../../components/TermsContainer/TermsContainer";
import termsJson from './TermsServices.json';
import privacyJson from './PrivacyPolicy.json';

const LegalTerms = ({terms}) => {

  const [width, setWidth] = useState(window.innerWidth);

  const isMobile = width <= 768;

  function handleWindowSizeChange() {
    setWidth(window.innerWidth);
  }

  useEffect(() => {

    if (terms === "terms-service"){
      document.title = `LQwD | Terms of Service`;
    }else if(terms === "privacy-policy"){
      document.title = `LQwD | Privacy Policy`;
    }else{
      document.title = `LQwD | Policies`;
    }

    window.addEventListener('resize', handleWindowSizeChange);
    return () => {
      window.removeEventListener('resize', handleWindowSizeChange);
    }
  }, [terms]);

  return (
    <>
      {(() => {
        switch (terms) {
          case "terms-service":
            return <TermsContainer title={termsJson.title} date={termsJson.date} json={termsJson.json} mobile={!isMobile}/>
          case "privacy-policy":
            return <TermsContainer title={privacyJson.title} date={privacyJson.date} json={privacyJson.json} mobile={!isMobile}/>
          default:
            return <div></div>
        }
      })()}

    </>
  );
}

export default LegalTerms;