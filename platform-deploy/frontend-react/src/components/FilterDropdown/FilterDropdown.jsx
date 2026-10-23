/* eslint-disable */
import React, { useEffect, useState } from "react";

import './FilterDropdown.css';
import PropTypes from 'prop-types';
import filterIcon from "../../public/icons/general/svg/Filter.svg";
import filterIconSelected from "../../public/icons/general/svg/FilterSelected.svg"
import { getMyChannelsNodes } from "../../containers/MyChannels/MyChannelsActions";

export default function FilterDropdown({filterTitle, filterStyle, filterOptions, isActive, onChange, onReset, ...rest }) {

  const {className, ...args} = rest;

  const [selected, setSelected] = useState(
    {
      filterList: filterOptions,
      activeFilters: []
    });

  const [showFilters, setShowFilters] = useState(false);

  const [countFilters, setCountFilters] = useState(0);

  const toggleFilters = () => {
    setShowFilters(!showFilters);
  };

  const toggleOutsideClick = () => {
    setShowFilters(false);
  }

  const resetSelected = () => {

    setCountFilters(0);
    filterOptions.map((item) => {
      item.selected = false;
    });

    setSelected({
      activeFilters: [],
      filterList: filterOptions,
    });

    onReset();
  };

  const setCounter = () => {
    let count = 0;
    selected.filterList.map((item) => {
      if (item.selected){
        count++;
      }
    });
    setCountFilters(count);
  }

  const selectFilter = (item) => {
    if (item.key === "all"){
      let tempSelected;
      if (!item.selected){
        tempSelected=true;
      }else {
        tempSelected=false;
      }
      filterOptions.map((item) => {
        item.selected = tempSelected;

      });
      setSelected({
        activeFilters: filterOptions,
        filterList: filterOptions
      })
    }else{
      item.selected = (!item.selected);
      filterOptions.map((item) => {
        if (item.key === "all") {
          item.selected = false;
        }
      });
      setSelected({
        activeFilters: filterOptions,
        filterList: filterOptions
      })
    }
    setCounter();
    onChange();
  }

  const overrideStrings = {
    clearSelected: "Reset",
    noOptions: "No Options",
    search: "Search",
  };

  useEffect(() => {
    resetSelected();
    const handleClickOutside = (event) => {
      let dropDownClass = document.querySelector(".filter-dropdown-options-panel");

      let filterTitle = document.querySelector(".filter-dropdown-container");

      if (dropDownClass != null) {
        if (dropDownClass.contains(event.target)) {
          console.log("clicked");
        }else if(filterTitle.contains(event.target)){
          console.log("clicked filter");
        }else{
          toggleOutsideClick();
        }
      }
    };
    document.addEventListener('click', handleClickOutside, true);
    return () => {
      document.removeEventListener('click', handleClickOutside, true);
    };
  }, []);

  return (
    <div className={"position-relative"}>
      <div className="filter-dropdown-container" onClick={toggleFilters}>
        <div className="filter-dropdown-icon">
          <object data={showFilters ? filterIconSelected : filterIcon}/>
        </div>
        <div className="filter-dropdown-text-container">
          <div className="filter-dropdown-text">{filterTitle}</div>
          <div className={(countFilters > 0) ? "" : "d-none"}>
            <div className="filter-dropdown-indicator-container">
              <div className="filter-dropdown-indicator">
                {countFilters}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={showFilters ? "filter-dropdown-options-panel" : "d-none"}>
        <div className="filter-dropdown-options-container">
          <div className="filter-dropdown-options-header">
            <div className="filter-dropdown-options-title">
              Channel Status
            </div>
            <div className="filter-dropdown-options-reset" onClick={resetSelected}>
              Reset
            </div>
          </div>
          <div className="filter-dropdown-options-list">
            <ul className="filter-dropdown-options-list-ul">
              {filterOptions.map((item) =>
                <li className="filter-dropdown-options-list-items">
                  <input className="filter-dropdown-options-list-item-checkbox" type="checkbox" value={item.value} id={item.id} onInput={() => selectFilter(item)} checked={item.selected}></input>
                  <label className="filter-dropdown-options-list-item-text" htmlFor={item.id}>
                    {item.value}
                  </label>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>

    </div>
  );
}

FilterDropdown.propTypes = {
  filterText: PropTypes.string,
  filterStyle: PropTypes.objectOf({
    normal: {
      color: PropTypes.string,
      backgroundColor: PropTypes.string,
      borderColor: PropTypes.string,
    },
    hover: {
      color: PropTypes.string,
      backgroundColor: PropTypes.string,
      borderColor: PropTypes.string,
    }
  }),
};

