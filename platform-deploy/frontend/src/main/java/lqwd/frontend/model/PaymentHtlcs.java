package lqwd.frontend.model;


import com.fasterxml.jackson.annotation.JsonAlias;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;

@Getter
@Setter
public class PaymentHtlcs {

    @JsonAlias({"attemptId", "attempt_id"})
    private String attempt_id;

    private String status;

    @JsonAlias({"totalFeesMsat", "total_fees_msat"})
    private Integer total_fees_msat;

    @JsonAlias({"totalAmtMsat", "total_amt_msat"})
    private Integer total_amt_msat;

    @JsonAlias({"attemptTimeNs", "attempt_time_ns"})
    private Double attempt_time_ns;

    @JsonAlias({"resolveTimeNs", "resolve_time_ns"})
    private Double resolve_time_ns;

    private String failure;

    @JsonAlias({"preimage", "preImage"})
    private String preimage;

    private ArrayList<PaymentHops> paymentHops;

    @Override
    public String toString(){
        return "Payment HTLCS \n" +
                "Attempt ID - " + this.getAttempt_id() + "\n" +
                "Status - " + this.getStatus() + "\n" +
                "Preimage - " + this.getPreimage() + "\n" +
                "Total Fees MSAT - " + String.valueOf(this.getTotal_fees_msat()) + "\n" +
                "Total Amount MSAT - " + String.valueOf(this.getTotal_amt_msat()) + "\n" +
                "Attempt Time NS - " + String.valueOf(this.getAttempt_time_ns()) + "\n" +
                "Resolve Time NS - " + String.valueOf(this.getResolve_time_ns());
    }
}
