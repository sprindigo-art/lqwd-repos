/* eslint-disable */
import React, { useState } from "react";
import searchIcon from '../../public/icons/general/svg/Search.svg';
import searchSelectedIcon from '../../public/icons/general/svg/SearchSelected.svg';
import './SearchField.css';

export default function SearchField({id, name, placeholder, onChange, handleClick, resultList}){

  const [selected, setSelected] = useState(false);

  const [showResults, setShowResults] = useState(false);

  const [value, setValue] = useState("");

  const [clicked, setClicked] = useState('');

  const handleOnClick = (value) => {
    console.log(value);
    hideResultsContainer();
    handleClick(value);
  };

  const handleOnChange = (event) => {
    event.preventDefault()
    showResultsContainer();
    setValue(event.target.value);
    onChange(event.target.value);
  };

  const showResultsContainer = () => {
    setSelected(!selected);
    setShowResults(true);
  };

  const hideResultsContainer = () => {
    setSelected(!selected);
    setShowResults(false);
  };

  return (
    <>
      <div className="search-field-container">
        <div className="search-field-result-container">
          <div className="search-field-input-frame">
            <div className="search-icon">
              <object data={(selected ? searchSelectedIcon : searchIcon)} height="20px" width="20px"></object>
            </div>
            <input className="search-field-input"
                   id={id} name={name} placeholder={placeholder}
                   onFocus={() => showResultsContainer()}
                   onChange={handleOnChange}
            />
          </div>

          <div className={showResults ? "search-results-panel" : "d-none"} onMouseLeave={() => hideResultsContainer()}>
            {resultList.filter(n => n).length > 0 ?
              <div className="search-results-container">
                {resultList.filter(n => n).map((item, num) => (
                  <div className="search-result-item search-result-item-text" onClick={() => handleOnClick(item)}>
                    {(item !== null) ? item.channelId: ""}
                  </div>
                ))}
              </div>
              :
              <div className="search-results-container">
                  <div className="search-result-item search-result-item-text">
                     No Results Found!
                  </div>
              </div>
            }
          </div>
        </div>
      </div>
    </>
  );
}