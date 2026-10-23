package lqwd.frontend.model;

import com.fasterxml.jackson.databind.DeserializationFeature;
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
public class FeeEstimate {
    private Double total_time_lock;

    private Double total_fees;

    private Double total_amt;

    private Double total_fees_msat;

    private Double total_amt_msat;

    private ArrayList<PaymentHops> paymentHops;

    private Float success_prob;

    private static Logger logger = LoggerFactory.getLogger(Payment.class);

    public FeeEstimate mapContent(String content){
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        FeeEstimate feeEstimate = new FeeEstimate();

        try {

            JSONObject jsonObject = new JSONObject(content);
            if (jsonObject.has("routes")) {
                JSONArray jsonArray = jsonObject.getJSONArray("routes");
                for (int i = 0; i < jsonArray.length(); i++) {
                    feeEstimate = mapper.readValue(jsonArray.getJSONObject(i).toString(), FeeEstimate.class);
                    if (jsonArray.getJSONObject(i).has("hops")){
                        JSONArray jsonArray1 = jsonArray.getJSONObject(i).getJSONArray("hops");
                        ArrayList<PaymentHops> paymentHops = new ArrayList<>();
                        Payment payment = new Payment();
                        for (int j = 0; j < jsonArray1.length(); j++){
                            PaymentHops paymentHop = new PaymentHops();

                            paymentHop = payment.mapPaymentHops(jsonArray1.getJSONObject(j).toString());
                            paymentHops.add(paymentHop);
                        }
                        feeEstimate.setPaymentHops(paymentHops);
                    }
                }
            }

            if (jsonObject.has("success_prob")){
                feeEstimate.setSuccess_prob(jsonObject.getFloat("success_prob"));
            }


        } catch (IOException e) {
//            e.printStackTrace();
            logger.error(e.getMessage());
        }

        return feeEstimate;
    }

    @Override
    public String toString(){
        return "\nFee Estimate:\n"
                + "Total Amt: " + this.getTotal_amt() + "\n"
                + "Total Fees: " + this.getTotal_fees() + "\n"
                + "Total Amt msat:"  + this.getTotal_amt_msat() + "\n"
                + "Total Fees msat: " + this.getTotal_fees_msat() + "\n"
                + "Total Time Lock: " + this.getTotal_time_lock() + "\n"
                + "Payment Hops: " + this.getPaymentHops();
    }
}
