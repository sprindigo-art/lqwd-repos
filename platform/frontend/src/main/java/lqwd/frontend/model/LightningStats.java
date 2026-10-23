package lqwd.frontend.model;

import lombok.Getter;
import lombok.Setter;

import javax.persistence.*;
import java.text.SimpleDateFormat;
import java.util.Date;

@Entity
@Table(name = "ml_stats_daily")
@Getter
@Setter
public class LightningStats {
    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    @Column(name="lastupdated", updatable = false, nullable = false)
    private Date lastupdated;

    @Column(name="numberofnodes", updatable = false, nullable = false)
    private Double numberofnodes;

    @Column(name="numberofnodes30dchange", updatable = false, nullable = false)
    private Double numberofnodes30dchange;

    @Column(name="numberofnodeswithactivechannels", updatable = false, nullable = false)
    private Double numberofnodeswithactivechannels;

    @Column(name="numberofnodeswithactivechannels30dchange", updatable = false, nullable = false)
    private Double numberofnodeswithactivechannels30dchange;

    @Column(name="numberofchannels", updatable = false, nullable = false)
    private Double numberofchannels;

    @Column(name="numberofchannels30dchange", updatable = false, nullable = false)
    private Double numberofchannels30dchange;

    @Column(name="networkcapacity", updatable = false, nullable = false)
    private Double networkcapacity;

    @Column(name="networkcapacity30dchange", updatable = false, nullable = false)
    private Double networkcapacity30dchange;

    @Column(name="networkcapacityusd", updatable = false, nullable = false)
    private Long networkcapacityusd;

    @Column(name="publicipnodes", updatable = false, nullable = false)
    private Double publicipnodes;

    @Column(name="ipv6nodes", updatable = false, nullable = false)
    private Double ipv6nodes;

    @Column(name="tornodes", updatable = false, nullable = false)
    private Double tornodes;

    @Column(name="newnodes24h", updatable = false, nullable = false)
    private Double newnodes24h;

    @Column(name="newchannels24h", updatable = false, nullable = false)
    private Double newchannels24h;

    @Column(name="updatednodes24h", updatable = false, nullable = false)
    private Double updatednodes24h;

    @Column(name="updatedchannels24h", updatable = false, nullable = false)
    private Double updatedchannels24h;

    @Column(name="layer1capacityratio", updatable = false, nullable = false)
    private Double layer1capacityratio;

    @Column(name="averagenodecapacity", updatable = false, nullable = false)
    private Double averagenodecapacity;

    @Column(name="averagenodecapacityusd", updatable = false, nullable = false)
    private Double averagenodecapacityusd;

    @Column(name="averagechannelcapacity", updatable = false, nullable = false)
    private Double averagechannelcapacity;

    @Column(name="averagechannelcapacityusd", updatable = false, nullable = false)
    private Double averagechannelcapacityusd;

    @Column(name="averagenodeagedays", updatable = false, nullable = false)
    private Double averagenodeagedays;

    @Column(name="averagechannelagedays", updatable = false, nullable = false)
    private Double averagechannelagedays;

    @Column(name="averagechannelpernode", updatable = false, nullable = false)
    private Double averagechannelpernode;

    @Column(name="medianbasefee", updatable = false, nullable = false)
    private Double medianbasefee;

    @Column(name="medianbasefeeusd", updatable = false, nullable = false)
    private Double medianbasefeeusd;

    @Column(name="medianfeerate", updatable = false, nullable = false)
    private Double medianfeerate;

    @Column(name="medianfeerateusd", updatable = false, nullable = false)
    private Double medianfeerateusd;

    public String getReabableLastUpdated(){
            SimpleDateFormat format = new SimpleDateFormat("E dd MMM yyyy");
            String lastUpdated = format.format(this.lastupdated);
            return lastUpdated;
    }

    public Double getBtcCapacity(){
        Double btcCapacity = this.networkcapacity*Math.pow(10,-8);
        return btcCapacity;
    }
    @Override
    public String toString(){
        return "\n1ML Stats Daily:\n"
                + "Last Updated: " + this.getLastupdated() + "\n"
                + "Number of Nodes: " + this.getNumberofnodes() + "\n"
                + "Number of Nodes 30d Change: " + this.getNumberofnodes30dchange() + "\n"
                + "Number of Nodes with Active Channels: " + this.getNumberofnodeswithactivechannels() + "\n"
                + "Number of Nodes with Active Channels 30d Change: " + this.getNumberofnodeswithactivechannels30dchange() + "\n"
                + "Number of Channels: " + this.getNumberofchannels() + "\n"
                + "Number of Channels 30d Change: " + this.getNumberofchannels30dchange() + "\n"
                + "Network Capacity: " + this.getNetworkcapacity() + "\n"
                + "Network Capacity 30d Change: " + this.getNetworkcapacity30dchange() + "\n"
                + "Network Capacity USD: " + this.getNetworkcapacityusd() + "\n"
                + "Public IP Nodes: " + this.getPublicipnodes() + "\n"
                + "IPv6 Nodes: " + this.getIpv6nodes() + "\n"
                + "Tor Nodes: " + this.getTornodes() + "\n"
                + "New Nodes 24h: " + this.getNewnodes24h() + "\n"
                + "New Channels 24h: " + this.getNewchannels24h() + "\n"
                + "Updated Nodes 24h: " + this.getUpdatednodes24h() + "\n"
                + "Updated Channels 24h: " + this.getUpdatedchannels24h() + "\n"
                + "Layer 1 Capacity Ratio: " + this.getLayer1capacityratio() + "\n"
                + "Average Node Capacity: " + this.getAveragenodecapacity() + "\n"
                + "Average Node Capacity USD: " + this.getAveragenodecapacityusd() + "\n"
                + "Average Channel Capacity: " + this.getAveragechannelcapacity() + "\n"
                + "Average Channel Capacity USD: " + this.getAveragechannelcapacityusd() + "\n"
                + "Average Node Age Days: " + this.getAveragenodeagedays() + "\n"
                + "Average Channel Age Days: " + this.getAveragechannelagedays() + "\n"
                + "Average Channel Per Node: " + this.getAveragechannelpernode() + "\n"
                + "Median Base Fee: " + this.getMedianbasefee() + "\n"
                + "Median Base Fee USD: " + this.getMedianbasefeeusd() + "\n"
                + "Median Fee Rate: " + this.getMedianfeerate() + "\n"
                + "Median Fee Rate USD: " + this.getMedianfeerateusd();
    }

}
