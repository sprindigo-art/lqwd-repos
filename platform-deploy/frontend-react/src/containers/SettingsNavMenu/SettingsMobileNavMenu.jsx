/* eslint-disable */
import React from 'react';
import './SettingsNavMenu.sass'
import { NavLink } from "react-router-dom";
import { navbarList } from './SettingsNavMenu'
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';


export default function SettingsMobileNavMenu() {
    const [value, setValue] = React.useState(0);

    const handleChange = (event, newValue) => {
        setValue(newValue);
    };

    return (
        <div>
            <Tabs
                value={value}
                onChange={handleChange}
                aria-label="icon position tabs example"
                variant="fullWidth"
            >
                {navbarList.map((item, num) => (
                    <Tab icon={<img src={item.icon} />} iconPosition="start" label={item.title} component={NavLink} to={item.path}  />

                ))}
            </Tabs>

        </div>
    );
}


