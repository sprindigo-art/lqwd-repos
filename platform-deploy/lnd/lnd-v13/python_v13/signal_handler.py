from lnd_notification import Notification
import config
from cipher_api_handler import CipherAPIHandler


class SignalHandler:
    kill_now = False

    def __init__(self):
        self.notification = Notification()
        self.lnd_config = config.read_config("lnd.ini", "lnd")
        self.cipher_api_handler = CipherAPIHandler()

    def check_status(self):
        status = self.cipher_api_handler.check_node_status(self.lnd_config["podname"])
        return status

    def graceful_shutdown(self):
        status = self.check_status()
        print(f"LND status is : {status}")
        if status != "DELETED":
            print("Sending restart email to user")
            self.send_email_notification()
        else:
            print("Node has been deleted. no need to send restart email")


    def send_email_notification(self):
        node_data = {
            "node_name": self.lnd_config["podname"],
            "network": self.lnd_config["lndnetwork"],
            "watch": self.lnd_config["watchtower"],
            "owner": self.lnd_config["owner"]
        }
        status = self.cipher_api_handler.update_node_status("NEED_RESTART",
                                                            self.lnd_config["podname"])

        print(f"LND update status code : {status}")
        self.notification.send_node_shutdown_email(node_data)


if __name__ == '__main__':
    killer = SignalHandler()
    killer.graceful_shutdown()
