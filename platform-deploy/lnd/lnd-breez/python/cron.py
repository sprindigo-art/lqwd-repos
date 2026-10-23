import os
from datetime import datetime
import lnd as lnd
from lnd_notification import Notification
from cipher_api_handler import CipherAPIHandler

def main():
    now = datetime.now()
    dt_string = now.strftime("%d/%m/%Y %H:%M:%S")
    print("\n\n ===============")
    print("Cron start time: ", dt_string)

    debug = os.getenv("DEBUG")

    lnd_object = lnd.Lnd(debug)

    check_status_result = lnd_object.check_lnd_status_in_db()
    print("Lnd node status now is :" + str(check_status_result))

    if check_status_result == "UPDATE_CONFIG_REQUESTED":
        lnd_object.create_lnd_config()

    if check_status_result == "RESTART_REQUESTED":
        lnd_config = lnd_object.get_lnd_config()
        stop_lnd_result = lnd_object.stop_lnd()
        if stop_lnd_result:
            now = datetime.now()
            dt_string = now.strftime("%d/%m/%Y %H:%M:%S")
            print("Lnd Node Stopped at: ", dt_string)

            start_lnd_result = lnd_object.start_lnd()
            if start_lnd_result:
                now = datetime.now()
                dt_string = now.strftime("%d/%m/%Y %H:%M:%S")
                print("Lnd Node Started at: ", dt_string)

                unlock_result = lnd_object.unlock_create_wallet()
                if unlock_result:
                    status = "RUNNING"
                    print("lnd node Unlocked successfully")
                    lnd_object.update_lnd_status(status)
                    cipher_api_handler = CipherAPIHandler()
                    status_result = cipher_api_handler.update_node_status(status,
                                                                  lnd_object.podname)
                    print("lnd node status in oauth2 updated to ", status_result)
                else:
                    notify_problem("unlock error", lnd_config)
                    print("lnd node not unlocked")
            else:
                notify_problem("stat lnd error", lnd_config)
                print("lnd node not started")
        else:
            notify_problem("stop lnd error", lnd_config)
            print("lnd node not stoped")

    if check_status_result == "UNLOCK_REQUESTED":
        lnd_config = lnd_object.get_lnd_config()
        unlock_result = lnd_object.unlock_create_wallet()
        print("unlock result is " + str(unlock_result))
        if unlock_result[0]:
            status = "RUNNING"
            print("lnd node Unlocked successfully")
            lnd_object.update_lnd_status(status)
            cipher_api_handler = CipherAPIHandler()
            status_result = cipher_api_handler.update_node_status(status,
                                                                lnd_object.podname)
            print("lnd node status in oauth2 updated to ", status_result)
            print("send message to kafka for oauth2 status")

        else:
            notify_problem("unlock error", lnd_config)
            print("lnd node not unlocked")

    now = datetime.now()
    dt_string = now.strftime("%d/%m/%Y %H:%M:%S")
    print("End time: ", dt_string)


def notify_problem(message, lnd_config):
    node_data = {
        "node_name": lnd_config["podname"],
        "network": lnd_config["lndnetwork"],
        "watch": lnd_config["watchtower"],
        "owner": lnd_config["owner"]
    }
    notification = Notification()
    notification.send_notify_problem


if __name__ == "__main__":
    main()
