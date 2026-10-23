package lqwd.frontend.model;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Getter;
import lombok.Setter;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.parameters.P;

import java.io.IOException;
import java.util.ArrayList;

@Getter
@Setter
public class Peer {

    private String pub_key;

    private String address;

    private String bytes_sent;

    private String bytes_recv;

    private Boolean inbound;

    private String ping_time;

    private String lnd_name;

    private static Logger logger = LoggerFactory.getLogger(Peer.class);

    public Peer mapContent(String content){
            ObjectMapper mapper = new ObjectMapper()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

            Peer peer = new Peer();
            try {

                if (content != null) {
                    peer = mapper.readValue(content, Peer.class);
                    logger.info(peer.toString());
                }else {
                    return null;
                }

            } catch (IOException e) {
                logger.error(e.getMessage());
            }
            return peer;
    }

    public ArrayList<Peer> mapPeerListContent(String content, String lnd_name) {
        ArrayList<Peer> peers = new ArrayList<>();

        JSONObject jsonObject = new JSONObject(content);
        if(jsonObject.has("peers")){
            JSONArray jsonArray = jsonObject.getJSONArray("peers");
            if (jsonArray.length() > 0) {
                for (int i = 0; i < jsonArray.length(); i++) {
                    Peer peer = this.mapContent(jsonArray.getJSONObject(i).toString());
                    peer.setLnd_name(lnd_name);
                    peers.add(peer);
                }
            }
        }else{
            return null;
        }

        return peers;
    }
    @Override
    public String toString(){
        return "Peer\n" +
                "Public Key: " + this.getPub_key() + "\n" +
                "Address: " + this.getAddress() + "\n" +
                "Bytes Sent: " + this.getBytes_sent() + "\n" +
                "Bytes Receive: " + this.getBytes_recv() + "\n" +
                "Ping Time: " + this.getPing_time() + "\n" +
                "Inbound: " + this.getInbound();
    }
}
