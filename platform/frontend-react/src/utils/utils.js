/* eslint-disable */

export function formatDate(date) {
    let month = '' + (date.getMonth() + 1);
    let day = '' + date.getDate();
    const year = date.getFullYear();

    if (month.length < 2) month = '0' + month;
    if (day.length < 2) day = '0' + day;

    return [day, month, year].join('-');
}

export function getFirstAndLastDayOfMonth() {
    const my_date = new Date();
    const first_date = new Date(my_date.getFullYear(), my_date.getMonth(), 1);
    const last_date = new Date(my_date.getFullYear(), my_date.getMonth() + 1, 0);

    return {
        first_date: formatDate(first_date),
        last_date: formatDate(last_date),
    };
}

export function getFirstAndLastDayOfMonthEpoch() {
    const my_date = new Date();
    const first_date = new Date(my_date.getFullYear(), my_date.getMonth(), 1);
    const last_date = new Date(my_date.getFullYear(), my_date.getMonth() + 1, 0);

    return {
        first_date: (first_date),
        last_date: (last_date),
    };
}

export function getFirstAndLastDayOfYear() {
    const my_date = new Date();
    const first_date = new Date(my_date.getFullYear(), 0, 1);
    const last_date = new Date(my_date.getFullYear() + 1, 0, 0);

    return {
        first_date: (first_date),
        last_date: (last_date),
    };
}

export function getUpcomingSunday() {
    const date = new Date();
    const today = date.getDate();
    const currentDay = date.getDay();
    const newDate = date.setDate(today - currentDay + 7);
    return new Date(newDate);
}

export function getLastSunday() {
    const date = new Date();
    const today = date.getDate();
    const currentDay = date.getDay();
    const newDate = date.setDate(today - (currentDay || 7));
    return new Date(newDate);
}

export const getDates = () => {
    const month = getFirstAndLastDayOfMonthEpoch();
    const year = getFirstAndLastDayOfYear();
    const weekStart = getLastSunday();
    const weekEnd = getUpcomingSunday();
    return {
        weekStart,
        weekEnd,
        monthStart: month.first_date,
        monthEnd: month.last_date,
        yearStart: year.first_date,
        yearEnd: year.last_date,
    }

}

export function dateDiffInDays(start, end) {
    const _MS_PER_DAY = 1000 * 60 * 60 * 24;
    // Discard the time and time-zone information.
    const utc1 = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const utc2 = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());

    return Math.floor((utc2 - utc1) / _MS_PER_DAY);
}

export function processSelectItemNode(nodes, shared) {
    let options = [];

    for (let i = 0; i < nodes.length; i += 1) {
        options.push({ "value": JSON.stringify(nodes[i]), "label": nodes[i].lndNodeName, "shared": shared })
    }

    return options
}

export function getNodeBalance(nodeName, nodeMap) {
    if(nodeMap.get(nodeName) != null){
        if (nodeMap.get(nodeName).balance != null){
            return nodeMap.get(nodeName).balance.confirmed_balance;
        }else{
            return 0;
        }
    }else {
        return 0;
    }
}

export function processSelectItemNodeMyChannels(nodes, nodeMap, shared) {
    let options = [];

    for (let i = 0; i < nodes.length; i += 1) {
        options.push({ "value": JSON.stringify(nodes[i]), "label": nodes[i].label, "balance": getNodeBalance(nodes[i].label, nodeMap), "shared": shared })
    }

    return options
}